from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, or_, text
from sqlalchemy.orm import joinedload
from werkzeug.utils import secure_filename
import os
import re
import json
from datetime import datetime, timedelta
from decimal import Decimal
import io
import pandas as pd
import numpy as np

from models import db, Execution, Trade, Position, DailyStats, OverallStats, HourlyStats, Tag, trade_tags, Account, ImportHistory, BrokerFormat, BrokerImportMapping, DailyJournal, EventTag
from stats_calculator import recalculate_all_stats, calculate_overall_stats, calculate_daily_stats, compute_sharpe_ratio
from csv_processor import (
    process_java_journal_csv, process_executions_into_trades, process_csv_with_format,
    _generate_trade_description, _generate_group_description, _detect_spread_type,
    _determine_trade_side
)
from auth import auth_bp
from sortino_equity import get_sortino_equity
from config import configure_app
from security import install_security
from database import SCHEMA_REVISION
from market_data.service import get_quote_service

app = Flask(__name__)

# Register blueprints
app.register_blueprint(auth_bp)

# Build DATABASE_URL from environment variables
# Allow override with full DATABASE_URL if provided
configure_app(app)

# Initialize extensions
db.init_app(app)
install_security(app)
allowed_origins = [origin.strip() for origin in os.environ.get('CORS_ORIGINS', '').split(',') if origin.strip()]
if allowed_origins:
    CORS(app, origins=allowed_origins, supports_credentials=True)

# ==================== API Routes ====================

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify(status='healthy', version='1.0.0')


@app.route('/api/ready', methods=['GET'])
def readiness_check():
    try:
        revision = db.session.execute(text('SELECT version_num FROM alembic_version')).scalar()
        return jsonify(status='ready' if revision == SCHEMA_REVISION else 'unavailable'), 200 if revision == SCHEMA_REVISION else 503
    except Exception:
        db.session.rollback()
        return jsonify(status='unavailable'), 503


def _mark_open_trade(trade, executions=None):
    """Live mark-to-market for an open trade. Never raises."""
    try:
        if executions is None:
            executions = Execution.query.filter_by(matched_trade_id=trade.id).all()
        if not executions:
            return {'open_pnl': None, 'open_positions': []}
        return get_quote_service().mark_trade(executions)
    except Exception as e:
        app.logger.debug(f"WARN: mark-to-market failed for trade {getattr(trade, 'id', None)}: {e}")
        return {'open_pnl': None, 'open_positions': []}

# ==================== Execution Routes ====================

@app.route('/api/executions', methods=['GET'])
def get_executions():
    """Get all executions with optional filtering and sorting"""
    try:
        # Query parameters
        symbol = request.args.get('symbol')
        underlying = request.args.get('underlying')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        start_datetime = request.args.get('start_datetime')
        end_datetime = request.args.get('end_datetime')
        entry_time_start = request.args.get('entry_time_start')
        entry_time_end = request.args.get('entry_time_end')
        exit_time_start = request.args.get('exit_time_start')
        exit_time_end = request.args.get('exit_time_end')
        duration_min_minutes = request.args.get('duration_min_minutes', type=float)
        duration_max_minutes = request.args.get('duration_max_minutes', type=float)
        side = request.args.get('side')
        asset_class = request.args.get('asset_class')
        matched = request.args.get('matched')
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort_by = request.args.get('sort_by', 'trade_date')
        sort_order = request.args.get('sort_order', 'desc')
        
        # Join with Account to get account_name
        query = db.session.query(Execution).outerjoin(Account, Execution.account_id == Account.id)
        
        # Handle matched filter
        app.logger.debug(f"DEBUG get_executions: matched param = {matched!r}")
        if matched is not None:
            if matched.lower() == 'true':
                query = query.filter(Execution.matched_trade_id.isnot(None))
                app.logger.debug("DEBUG get_executions: filtering for matched trades")
            elif matched.lower() == 'false':
                query = query.filter(Execution.matched_trade_id.is_(None))
                app.logger.debug("DEBUG get_executions: filtering for unmatched trades")
            else:
                app.logger.debug(f"DEBUG get_executions: unrecognized matched value '{matched}', skipping filter")
        else:
            app.logger.debug("DEBUG get_executions: no matched filter applied")
        
        # Log the generated SQL for debugging
        try:
            sql = str(query.statement.compile(compile_kwargs={"literal_binds": True}))
            app.logger.debug(f"DEBUG get_executions SQL: {sql[:500]}...")
        except Exception as e:
            app.logger.debug(f"DEBUG get_executions: could not log SQL: {e}")
        
        if symbol:
            # Normalize spaces for matching: remove all spaces from search term
            # and compare against column with spaces removed
            search_no_spaces = symbol.replace(' ', '')
            query = query.filter(
                db.func.replace(Execution.symbol, ' ', '').ilike(f'%{search_no_spaces}%')
            )
        if underlying:
            query = query.filter(Execution.underlying_symbol.ilike(f'%{underlying}%'))
        
        # Handle datetime filters (takes precedence over date filters)
        if start_datetime:
            query = query.filter(Execution.exec_datetime >= datetime.fromisoformat(start_datetime.replace('Z', '+00:00')))
        elif start_date:
            query = query.filter(Execution.trade_date >= datetime.fromisoformat(start_date).date())
            
        if end_datetime:
            query = query.filter(Execution.exec_datetime <= datetime.fromisoformat(end_datetime.replace('Z', '+00:00')))
        elif end_date:
            query = query.filter(Execution.trade_date <= datetime.fromisoformat(end_date).date())
        
        # Handle entry time filters (time of day, e.g., "09:30")
        if entry_time_start:
            query = query.filter(func.to_char(Execution.exec_datetime, 'HH24:MI') >= entry_time_start)
        if entry_time_end:
            query = query.filter(func.to_char(Execution.exec_datetime, 'HH24:MI') <= entry_time_end)
            
        if side:
            query = query.filter(Execution.side == side.upper())
        if asset_class:
            query = query.filter(Execution.asset_class == asset_class.upper())
        exec_filter = _account_filter(Execution.account_id, _parse_account_ids_arg(request.args))
        if exec_filter is not None:
            query = query.filter(exec_filter)
        
        # Apply sorting
        sort_column = getattr(Execution, sort_by, Execution.trade_date)
        if sort_order.lower() == 'desc':
            query = query.order_by(sort_column.desc())
        else:
            query = query.order_by(sort_column.asc())
        
        total = query.count()
        executions = query.limit(limit).offset(offset).all()
        
        # Build result with account_name manually added from the joined Account
        data = []
        for e in executions:
            exec_dict = e.to_dict()
            # If account_name is still None but we have an account from the outerjoin, use it
            if not exec_dict.get('account_name') and hasattr(e, 'account') and e.account:
                exec_dict['account_name'] = e.account.name
            data.append(exec_dict)
        
        return jsonify({
            'success': True,
            'data': data,
            'total': total,
            'limit': limit,
            'offset': offset
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions', methods=['POST'])
def create_execution():
    """Create a new execution"""
    try:
        data = request.json
        
        # Validate required fields
        if not data.get('symbol'):
            return jsonify({'success': False, 'error': 'Symbol is required'}), 400
        if not data.get('account_id'):
            return jsonify({'success': False, 'error': 'Account ID is required'}), 400
        if not data.get('quantity'):
            return jsonify({'success': False, 'error': 'Quantity is required'}), 400
        if not data.get('price'):
            return jsonify({'success': False, 'error': 'Price is required'}), 400
        if not data.get('trade_date'):
            return jsonify({'success': False, 'error': 'Trade date is required'}), 400
        
        # Fetch account for fallback ID/alias if not provided
        account = Account.query.get(data.get('account_id'))
        account_name = account.name if account else None
        account_number = account.account_number if account else None
        fallback_client_id = account_number if account_number else account_name
        
        # Create execution
        execution = Execution(
            account_id=data.get('account_id'),
            symbol=data.get('symbol', '').upper(),
            description=data.get('description'),
            underlying_symbol=data.get('underlying_symbol', '').upper() if data.get('underlying_symbol') else None,
            asset_class=data.get('asset_class', 'OPT'),
            side=data.get('side', 'BUY'),
            quantity=data.get('quantity'),
            price=data.get('price'),
            strike=data.get('strike'),
            expiry=datetime.fromisoformat(data.get('expiry')).date() if data.get('expiry') else None,
            put_call=data.get('put_call'),
            multiplier=data.get('multiplier', 100),
            commission=data.get('commission', 0),
            broker_execution_commission=data.get('broker_execution_commission', 0),
            commission_currency=data.get('commission_currency', 'USD'),
            net_cash=data.get('net_cash', 0),
            amount=data.get('amount'),
            proceeds=data.get('proceeds'),
            trade_date=datetime.fromisoformat(data.get('trade_date')).date() if data.get('trade_date') else None,
            exec_datetime=datetime.fromisoformat(data.get('exec_datetime').replace('Z', '+00:00')) if data.get('exec_datetime') else None,
            order_time=datetime.fromisoformat(data.get('order_time').replace('Z', '+00:00')) if data.get('order_time') else None,
            exchange=data.get('exchange'),
            notes=data.get('notes'),
            client_account_id=data.get('client_account_id') or fallback_client_id,
            account_alias=data.get('account_alias') or account_name,
        )
        
        db.session.add(execution)
        db.session.commit()
        
        # Process executions into trades for this account
        process_executions_into_trades(data.get('account_id'))
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({'success': True, 'data': execution.to_dict(), 'message': 'Execution created successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions/<int:execution_id>', methods=['GET'])
def get_execution(execution_id):
    """Get a single execution by ID"""
    try:
        execution = Execution.query.get_or_404(execution_id)
        return jsonify({'success': True, 'data': execution.to_dict()})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions/<int:execution_id>', methods=['PUT'])
def update_execution(execution_id):
    """Update an execution"""
    try:
        execution = Execution.query.get_or_404(execution_id)
        data = request.json
        
        # Update fields that are allowed to be modified
        updatable_fields = [
            'symbol', 'side', 'quantity', 'price', 'strike', 'expiry', 'put_call',
            'multiplier', 'asset_class', 'commission', 'net_cash', 'amount', 
            'proceeds', 'description', 'exchange', 'notes',
            'underlying_symbol'
        ]
        
        for field in updatable_fields:
            if field in data:
                if field == 'underlying_symbol':
                    # Special handling: uppercase and convert empty to None
                    value = data[field]
                    execution.underlying_symbol = value.upper() if value else None
                elif field == 'symbol':
                    # Special handling: uppercase the symbol
                    value = data[field]
                    execution.symbol = value.upper() if value else value
                else:
                    setattr(execution, field, data[field])
        
        # Update timestamps
        if 'exec_datetime' in data:
            execution.exec_datetime = data['exec_datetime']
        if 'trade_date' in data:
            execution.trade_date = data['trade_date']
        
        db.session.commit()
        
        # Process executions into trades for this account
        process_executions_into_trades(execution.account_id)
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({'success': True, 'data': execution.to_dict(), 'message': 'Execution updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions/<int:execution_id>', methods=['DELETE'])
def delete_execution(execution_id):
    """Delete an execution"""
    try:
        execution = Execution.query.get_or_404(execution_id)
        account_id = execution.account_id
        matched_trade_id = execution.matched_trade_id
        db.session.delete(execution)
        db.session.commit()
        
        # Only recalculate if the execution was part of a trade
        if matched_trade_id:
            # Process executions into trades for this account
            if account_id:
                process_executions_into_trades(account_id)
            
            # Recalculate stats
            recalculate_all_stats()
        
        return jsonify({'success': True, 'message': 'Execution deleted successfully'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


_SPLIT_MONEY_FIELDS = (
    'commission',
    'broker_execution_commission',
    'amount',
    'proceeds',
    'net_cash',
)
_SPLIT_COPY_SKIP = {
    'id',
    'quantity',
    'exec_id',
    'created_at',
    'updated_at',
    *_SPLIT_MONEY_FIELDS,
}
_SPLIT_QUANTIZE = Decimal('0.0001')


def _to_decimal(value):
    if value is None:
        return Decimal('0')
    return Decimal(str(value))


def _is_whole_decimal(value):
    return value == value.to_integral_value()


def _signed_quantity(abs_qty, side):
    return abs_qty if (side or '').upper() == 'BUY' else -abs_qty


def _pro_rata_money(originals, abs_qtys):
    total = sum(abs_qtys)
    pieces = []
    allocated = {field: Decimal('0') for field in _SPLIT_MONEY_FIELDS}
    for i, qty in enumerate(abs_qtys):
        if i < len(abs_qtys) - 1:
            share = {
                field: (originals[field] * qty / total).quantize(_SPLIT_QUANTIZE)
                for field in _SPLIT_MONEY_FIELDS
            }
            pieces.append(share)
            for field in _SPLIT_MONEY_FIELDS:
                allocated[field] += share[field]
        else:
            pieces.append({
                field: originals[field] - allocated[field]
                for field in _SPLIT_MONEY_FIELDS
            })
    return pieces


@app.route('/api/executions/<int:execution_id>/split', methods=['POST'])
def split_execution(execution_id):
    """Split one unmatched execution into 2+ executions with pro-rata money fields."""
    try:
        execution = db.session.get(Execution, execution_id)
        if execution is None:
            return jsonify({'success': False, 'error': 'Execution not found'}), 404

        if execution.matched_trade_id is not None:
            return jsonify({'success': False, 'error': 'Unmatch from trade first'}), 400

        original_abs = abs(_to_decimal(execution.quantity))
        if original_abs < 2 or not _is_whole_decimal(original_abs):
            return jsonify({'success': False, 'error': 'Cannot split'}), 400

        data = request.json or {}
        raw_quantities = data.get('quantities')
        if not isinstance(raw_quantities, list) or len(raw_quantities) < 2:
            return jsonify({'success': False, 'error': 'At least 2 pieces required'}), 400

        abs_qtys = []
        for raw in raw_quantities:
            try:
                abs_qty = abs(_to_decimal(raw))
            except Exception:
                return jsonify({'success': False, 'error': 'Invalid quantity'}), 400
            if abs_qty < 1 or not _is_whole_decimal(abs_qty):
                return jsonify({'success': False, 'error': 'Invalid quantity'}), 400
            abs_qtys.append(abs_qty)

        if sum(abs_qtys) != original_abs:
            return jsonify({'success': False, 'error': 'Quantities must sum to the original'}), 400

        originals = {field: _to_decimal(getattr(execution, field)) for field in _SPLIT_MONEY_FIELDS}
        pieces = _pro_rata_money(originals, abs_qtys)

        copied = {}
        for column in Execution.__table__.columns:
            if column.name not in _SPLIT_COPY_SKIP:
                copied[column.name] = getattr(execution, column.name)

        execution.quantity = _signed_quantity(abs_qtys[0], execution.side)
        for field in _SPLIT_MONEY_FIELDS:
            setattr(execution, field, pieces[0][field])

        created = []
        for i in range(1, len(abs_qtys)):
            kwargs = dict(copied)
            kwargs['quantity'] = _signed_quantity(abs_qtys[i], execution.side)
            kwargs['exec_id'] = None
            for field in _SPLIT_MONEY_FIELDS:
                kwargs[field] = pieces[i][field]
            new_execution = Execution(**kwargs)
            db.session.add(new_execution)
            created.append(new_execution)

        db.session.commit()

        return jsonify({
            'success': True,
            'data': [execution.to_dict()] + [row.to_dict() for row in created],
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions/<int:execution_id>/toggle-open', methods=['POST'])
def toggle_execution_open(execution_id):
    """Toggle is_open flag on an execution and recalc its trade's entry/exit arrays."""
    try:
        execution = Execution.query.get_or_404(execution_id)
        
        # Toggle: None -> True, True -> False, False -> True
        if execution.is_open is None:
            execution.is_open = True
        else:
            execution.is_open = not execution.is_open
        
        # If execution belongs to a trade, recalc the trade's entry/exit arrays
        if execution.matched_trade_id:
            trade = Trade.query.get(execution.matched_trade_id)
            if trade:
                execs = Execution.query.filter_by(matched_trade_id=trade.id).all()
                entry_ids = [e.id for e in execs if e.is_open]
                exit_ids = [e.id for e in execs if not e.is_open]
                trade.entry_execution_ids = json.dumps(entry_ids)
                trade.exit_execution_ids = json.dumps(exit_ids)
                
                # Recalc trade side from first open execution
                if entry_ids:
                    open_execs = [e for e in execs if e.is_open]
                    open_execs.sort(key=lambda x: (x.exec_datetime or datetime.min, -float(x.price or 0)))
                    trade.side = 'LONG' if open_execs[0].side == 'BUY' else 'SHORT'
                
                # Recalculate trade aggregate fields (is_open, open_qty, P&L, etc.)
                # reclassify=False preserves manual open/close toggles
                result = _recalculate_trade_fields(trade, execs, reclassify=False)
                if not result['success']:
                    # Fallback if recalc fails (e.g., no entry executions left)
                    from math import gcd
                    from functools import reduce
                    position_by_symbol = {}
                    for e in execs:
                        qty = float(e.quantity) if e.quantity is not None else 0
                        if e.side == 'SELL' and qty > 0:
                            qty = -qty
                        elif e.side == 'BUY' and qty < 0:
                            qty = abs(qty)
                        position_by_symbol[e.symbol] = position_by_symbol.get(e.symbol, 0) + qty
                    is_trade_open = any(abs(pos) > 0.0001 for pos in position_by_symbol.values())
                    trade.is_open = is_trade_open
                    trade.open_qty = _calculate_open_quantity(execs) if is_trade_open else 0
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': execution.to_dict(),
            'message': f'Execution marked as {"open" if execution.is_open else "close"}'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


def _unlink_executions_from_trade(trade_id, execution_ids):
    """Unlink executions from a trade without deleting them.

    Every id must belong to this trade, and the trade must keep at least one
    execution. The unlink is committed before recalculation so it persists if
    recalc fails.

    Returns (payload, status_code). A single id keeps the original unassign
    response shape: payload['data'] is that execution's dict.
    """
    if not isinstance(execution_ids, list) or len(execution_ids) == 0:
        return {'success': False, 'error': 'No execution IDs provided'}, 400

    unique_ids = []
    seen = set()
    for raw_id in execution_ids:
        try:
            execution_id = int(raw_id)
        except (TypeError, ValueError):
            return {'success': False, 'error': 'Invalid execution id'}, 400
        if execution_id not in seen:
            seen.add(execution_id)
            unique_ids.append(execution_id)

    executions = Execution.query.filter(Execution.id.in_(unique_ids)).all()
    if len(executions) != len(unique_ids):
        return {'success': False, 'error': 'Some executions not found'}, 404

    trade = db.session.get(Trade, trade_id)
    if not trade:
        cleared = False
        for execution in executions:
            if execution.matched_trade_id == trade_id:
                execution.matched_trade_id = None
                cleared = True
        if cleared:
            db.session.commit()
        return {'success': False, 'error': 'Trade not found; execution linkage cleared'}, 404

    not_on_trade = [e for e in executions if e.matched_trade_id != trade.id]
    if not_on_trade:
        if len(unique_ids) == 1 and not_on_trade[0].matched_trade_id is None:
            return {'success': False, 'error': 'Execution is not assigned to any trade'}, 400
        return {'success': False, 'error': 'One or more executions are not assigned to this trade'}, 400

    unlink_ids = set(unique_ids)
    linked = Execution.query.filter_by(matched_trade_id=trade.id).all()
    remaining = [e for e in linked if e.id not in unlink_ids]
    if not remaining:
        if len(unique_ids) == 1:
            error = 'Cannot remove the only execution from a trade. Use "Unmatch Trade" instead.'
        else:
            error = 'Cannot remove every execution from a trade. Use "Unmatch Trade" instead.'
        return {'success': False, 'error': error}, 400

    entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
    exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
    trade.entry_execution_ids = json.dumps([eid for eid in entry_ids if eid not in unlink_ids])
    trade.exit_execution_ids = json.dumps([eid for eid in exit_ids if eid not in unlink_ids])
    for execution in executions:
        execution.matched_trade_id = None

    # Commit the unlink FIRST so it persists even if recalc fails
    db.session.commit()

    remaining = Execution.query.filter_by(matched_trade_id=trade.id).all()
    result = _recalculate_trade_fields(trade, remaining)

    def response_data():
        rows = [e.to_dict() for e in executions]
        return rows[0] if len(rows) == 1 else rows

    if not result['success']:
        removed = 'Execution' if len(unique_ids) == 1 else 'Executions'
        return {
            'success': True,
            'data': response_data(),
            'warning': f"{removed} removed, but trade recalculation failed: {result.get('error')}. "
                       "Use the Recalculate action on the trade."
        }, 200

    db.session.commit()
    recalculate_all_stats()

    if len(unique_ids) == 1:
        message = f'Execution removed from trade #{trade.id} and trade recalculated'
    else:
        message = f'{len(unique_ids)} executions removed from trade #{trade.id} and trade recalculated'

    return {
        'success': True,
        'data': response_data(),
        'message': message,
    }, 200


@app.route('/api/executions/<int:execution_id>/unassign', methods=['POST'])
def unassign_execution_from_trade(execution_id):
    """Remove an execution from its trade without deleting it.

    The execution becomes unmatched (matched_trade_id = None) so it can be
    assigned to a different trade, and the trade is recalculated from its
    remaining executions.
    """
    try:
        execution = Execution.query.get_or_404(execution_id)

        if not execution.matched_trade_id:
            return jsonify({'success': False, 'error': 'Execution is not assigned to any trade'}), 400

        payload, status = _unlink_executions_from_trade(execution.matched_trade_id, [execution.id])
        return jsonify(payload), status
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/unassign', methods=['POST'])
def unassign_executions_from_trade(trade_id):
    """Remove several executions from a trade without deleting them.

    Body: {"execution_ids": [1, 2, ...]}. Same rules as the single unassign:
    executions stay in the journal, the trade is recalculated, and at least
    one execution must remain (use Unmatch Trade to drop the whole trade).
    """
    try:
        data = request.get_json(silent=True) or {}
        payload, status = _unlink_executions_from_trade(trade_id, data.get('execution_ids', []))
        return jsonify(payload), status
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions/combine', methods=['POST'])
def combine_executions_into_trade():
    """Manually combine selected executions into a trade"""
    try:
        data = request.json
        execution_ids = data.get('execution_ids', [])
        
        if len(execution_ids) < 1:
            return jsonify({'success': False, 'error': 'At least 1 execution is required'}), 400
        
        # Get all executions
        executions = Execution.query.filter(Execution.id.in_(execution_ids)).all()
        
        if len(executions) != len(execution_ids):
            return jsonify({'success': False, 'error': 'Some executions not found'}), 404
        
        # Check if any executions are already assigned to trades
        already_assigned = []
        for exec in executions:
            if exec.matched_trade_id is not None:
                already_assigned.append({
                    'execution_id': exec.id,
                    'symbol': exec.symbol,
                    'trade_id': exec.matched_trade_id
                })
        
        if already_assigned:
            return jsonify({
                'success': False, 
                'error': f'{len(already_assigned)} executions are already assigned to trades. Unmatch the existing trades first.',
                'assigned_executions': already_assigned
            }), 400
        
        # Validate all executions are for the same account
        account_ids = set(e.account_id for e in executions)
        if len(account_ids) > 1:
            return jsonify({'success': False, 'error': 'All executions must be for the same account'}), 400
        
        # Note: executions can have different symbols (spreads, combos, etc.)
        
        # Sort executions by datetime, then by price descending for deterministic ordering
        executions.sort(key=lambda x: (x.exec_datetime or x.trade_date or datetime.min, -float(x.price or 0)))
        
        # Set is_open flag per symbol (open/close tracking) BEFORE determining entry/exit
        is_open_map = _classify_executions_by_symbol(executions)
        for e in executions:
            e.is_open = is_open_map.get(e.id)
        
        # Trade entry/exit are determined by is_open: opens = entries, closes = exits.
        # The trade's side (LONG/SHORT) is set from the first OPEN execution.
        entry_execs = [e for e in executions if e.is_open]
        exit_execs = [e for e in executions if not e.is_open]
        
        if not entry_execs:
            return jsonify({'success': False, 'error': 'No entry (open) executions found'}), 400
        
        # Trade side: use spread-aware side determination
        side = _determine_trade_side(entry_execs)
        
        # Calculate trade values
        account_id = executions[0].account_id
        symbol = executions[0].symbol
        
        # Calculate entry values (all open executions)
        entry_net_cash = sum(float(e.net_cash or 0) for e in entry_execs)
        entry_commission = sum(float(e.commission or 0) for e in entry_execs)
        entry_weighted_price = _net_price(entry_execs, is_exit=False)
        
        # Calculate exit values (all close executions) — optional for open trades
        if exit_execs:
            exit_net_cash = sum(float(e.net_cash or 0) for e in exit_execs)
            exit_commission = sum(float(e.commission or 0) for e in exit_execs)
            exit_weighted_price = _net_price(exit_execs, is_exit=True)
        else:
            exit_net_cash = 0
            exit_commission = 0
            exit_weighted_price = None
        
        # Use spread-aware quantity calculation (GCD for multi-symbol trades)
        trade_qty = _calculate_spread_quantity(entry_execs)
        
        # Create trade
        first_entry = entry_execs[0]
        last_exit = exit_execs[-1] if exit_execs else None
        
        # Auto-generate description for spread trades
        auto_description = _generate_trade_description(executions)
        
        trade = Trade(
            account_id=account_id,
            symbol=symbol,
            description=auto_description or symbol,
            underlying_symbol=first_entry.underlying_symbol,
            asset_class=first_entry.asset_class,
            strike=first_entry.strike,
            expiry=first_entry.expiry,
            put_call=first_entry.put_call,
            entry_date=first_entry.trade_date,
            exit_date=last_exit.trade_date if last_exit else None,
            entry_price=entry_weighted_price,
            exit_price=exit_weighted_price,
            quantity=trade_qty,
            side=side,
            gross_pnl=entry_net_cash + exit_net_cash + entry_commission + exit_commission if exit_execs else 0,
            total_commissions=entry_commission + exit_commission if exit_execs else 0,
            net_pnl=entry_net_cash + exit_net_cash if exit_execs else 0,
            entry_execution_ids=json.dumps([e.id for e in entry_execs]),
            exit_execution_ids=json.dumps([e.id for e in exit_execs]),
            is_open=not exit_execs,
            open_qty=trade_qty if not exit_execs else 0,
        )
        
        db.session.add(trade)
        db.session.flush()
        
        # Link executions to trade, then recalc so a partial close stays open
        for e in executions:
            e.matched_trade_id = trade.id

        recalc = _recalculate_trade_fields(trade, executions)
        if not recalc['success']:
            db.session.rollback()
            return jsonify({'success': False, 'error': recalc.get('error') or 'Failed to calculate trade'}), 400

        db.session.commit()
        
        # Recalculate stats
        recalculate_all_stats()
        
        if trade.is_open:
            message = f'Created open trade #{trade.id} with {len(executions)} execution(s)'
        else:
            message = f'Created closed trade #{trade.id} with {len(executions)} execution(s)'
        
        return jsonify({
            'success': True, 
            'data': trade.to_dict(), 
            'message': message
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Trade Routes ====================

@app.route('/api/trades', methods=['GET'])
def get_trades():
    """Get all completed trades with optional filtering and sorting"""
    try:
        from sqlalchemy import func as sql_func
        
        # Query parameters
        symbol = request.args.get('symbol')
        underlying = request.args.get('underlying')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        date_filter_mode = request.args.get('date_filter_mode', 'active_date')  # exit_date, entry_date, active_date
        entry_time_start = request.args.get('entry_time_start')  # HH:MM format
        entry_time_end = request.args.get('entry_time_end')
        exit_time_start = request.args.get('exit_time_start')
        exit_time_end = request.args.get('exit_time_end')
        duration_min_minutes = request.args.get('duration_min_minutes', type=float)
        duration_max_minutes = request.args.get('duration_max_minutes', type=float)
        side = request.args.get('side')
        account_ids = _parse_account_ids_arg(request.args)
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)
        sort_by = request.args.get('sort_by', 'exit_date')
        sort_order = request.args.get('sort_order', 'desc')
        
        # Start with base query
        query = Trade.query
        
        if symbol:
            # Normalize spaces for matching: remove all spaces from search term
            # and compare against column with spaces removed
            search_no_spaces = symbol.replace(' ', '')
            query = query.filter(
                db.func.replace(Trade.symbol, ' ', '').ilike(f'%{search_no_spaces}%')
            )
        if underlying:
            query = query.filter(Trade.underlying_symbol.ilike(f'%{underlying}%'))
        
        # Handle date filters based on date_filter_mode
        if start_date and end_date:
            start = datetime.fromisoformat(start_date).date()
            end = datetime.fromisoformat(end_date).date()
            
            if date_filter_mode == 'exit_date':
                # Filter by when trade closed (default for P&L display)
                query = query.filter(Trade.exit_date >= start, Trade.exit_date <= end)
            elif date_filter_mode == 'entry_date':
                # Filter by when trade opened
                query = query.filter(Trade.entry_date >= start, Trade.entry_date <= end)
            elif date_filter_mode == 'active_date':
                # Filter by trades that were open during this period
                # (entered before or on end_date, exited after or on start_date, or still open)
                query = query.filter(
                    Trade.entry_date <= end,
                    or_(Trade.exit_date >= start, Trade.exit_date.is_(None))
                )
        elif start_date:
            start = datetime.fromisoformat(start_date).date()
            if date_filter_mode == 'exit_date':
                query = query.filter(Trade.exit_date >= start)
            elif date_filter_mode == 'entry_date':
                query = query.filter(Trade.entry_date >= start)
            elif date_filter_mode == 'active_date':
                query = query.filter(or_(Trade.exit_date >= start, Trade.exit_date.is_(None)))
        elif end_date:
            end = datetime.fromisoformat(end_date).date()
            if date_filter_mode == 'exit_date':
                query = query.filter(Trade.exit_date <= end)
            elif date_filter_mode == 'entry_date':
                query = query.filter(Trade.entry_date <= end)
            elif date_filter_mode == 'active_date':
                query = query.filter(Trade.entry_date <= end)
        
        # Handle side and account filters early
        if side:
            query = query.filter(Trade.side == side.upper())
        trade_account_filter = _account_filter(Trade.account_id, account_ids)
        if trade_account_filter is not None:
            query = query.filter(trade_account_filter)
        
        # Handle trade_status filter (all, open, closed)
        trade_status = request.args.get('trade_status', 'all').lower()
        if trade_status == 'open':
            query = query.filter(Trade.is_open == True)
        elif trade_status == 'closed':
            query = query.filter(Trade.is_open == False)
        # If 'all', no filter applied
        
        # Handle tag filtering
        tag_ids = request.args.getlist('tag_ids', type=int)
        tag_mode = request.args.get('tag_mode', 'AND')
        if tag_mode == 'NONE':
            query = query.filter(~Trade.tags_list.any())
        elif tag_ids:
            if tag_mode == 'AND':
                for tag_id in tag_ids:
                    query = query.filter(Trade.tags_list.any(Tag.id == tag_id))
            else:
                query = query.filter(Trade.tags_list.any(Tag.id.in_(tag_ids)))
        
        # Get filtered trade IDs first
        trade_ids_query = query.with_entities(Trade.id)
        trade_ids = [row[0] for row in trade_ids_query.all()]
        
        if not trade_ids:
            return jsonify({
                'success': True,
                'data': [],
                'total': 0,
                'limit': limit,
                'offset': offset
            })
        
        # Apply time and duration filters using execution data
        if entry_time_start or entry_time_end or exit_time_start or exit_time_end or duration_min_minutes is not None or duration_max_minutes is not None:
            # Get all executions for these trades - explicitly order by datetime
            executions = Execution.query.filter(
                Execution.matched_trade_id.in_(trade_ids),
                Execution.exec_datetime.isnot(None)
            ).order_by(Execution.exec_datetime.asc()).all()
            
            app.logger.debug(f"DEBUG: Found {len(executions)} executions")
            
            # Group executions by trade and calculate entry/exit times
            trade_execs = {}
            for exec in executions:
                tid = exec.matched_trade_id
                if tid not in trade_execs:
                    trade_execs[tid] = []
                trade_execs[tid].append({
                    'datetime': exec.exec_datetime,
                    'exec_id': exec.id,
                    'side': exec.side
                })
            
            # Filter trades based on time/duration criteria
            filtered_trade_ids = []
            for tid, exec_list in trade_execs.items():
                if not exec_list:
                    continue
                
                # Already sorted by datetime from SQL, but double-check
                sorted_execs = sorted(exec_list, key=lambda x: x['datetime'])
                entry_exec = sorted_execs[0]  # First = entry
                exit_exec = sorted_execs[-1]  # Last = exit
                
                entry_dt = entry_exec['datetime']
                exit_dt = exit_exec['datetime']
                
                # Extract HH:MM for comparison
                entry_time = entry_dt.strftime('%H:%M')
                exit_time = exit_dt.strftime('%H:%M')
                duration_mins = (exit_dt - entry_dt).total_seconds() / 60.0
                
                app.logger.debug(f"DEBUG: Trade {tid}: entry={entry_time} (exec_id={entry_exec['exec_id']}, side={entry_exec['side']}), exit={exit_time} (exec_id={exit_exec['exec_id']}, side={exit_exec['side']}), duration={duration_mins:.1f}m")
                
                # Check entry time filter
                if entry_time_start and entry_time < entry_time_start:
                    app.logger.debug(f"DEBUG:   SKIP - entry {entry_time} < {entry_time_start}")
                    continue
                if entry_time_end and entry_time > entry_time_end:
                    app.logger.debug(f"DEBUG:   SKIP - entry {entry_time} > {entry_time_end}")
                    continue
                
                # Check exit time filter
                if exit_time_start and exit_time < exit_time_start:
                    app.logger.debug(f"DEBUG:   SKIP - exit {exit_time} < {exit_time_start}")
                    continue
                if exit_time_end and exit_time > exit_time_end:
                    app.logger.debug(f"DEBUG:   SKIP - exit {exit_time} > {exit_time_end}")
                    continue
                
                # Check duration filter
                if duration_min_minutes is not None and duration_mins < duration_min_minutes:
                    app.logger.debug(f"DEBUG:   SKIP - duration {duration_mins} < {duration_min_minutes}")
                    continue
                if duration_max_minutes is not None and duration_mins > duration_max_minutes:
                    app.logger.debug(f"DEBUG:   SKIP - duration {duration_mins} > {duration_max_minutes}")
                    continue
                
                app.logger.debug(f"DEBUG:   KEEP")
                filtered_trade_ids.append(tid)
            
            app.logger.debug(f"DEBUG: After time filter: {len(filtered_trade_ids)} trades")
            
            if not filtered_trade_ids:
                return jsonify({
                    'success': True,
                    'data': [],
                    'total': 0,
                    'limit': limit,
                    'offset': offset
                })
            
            trade_ids = filtered_trade_ids
        
        # Build final query with filtered IDs
        final_query = Trade.query.filter(Trade.id.in_(trade_ids))
        
        # Apply sorting
        sort_column = getattr(Trade, sort_by, Trade.exit_date)
        if sort_order.lower() == 'desc':
            final_query = final_query.order_by(sort_column.desc().nullsfirst(), Trade.id.desc())
        else:
            final_query = final_query.order_by(sort_column.asc().nullslast(), Trade.id.asc())
        
        total = len(trade_ids)
        trades = final_query.limit(limit).offset(offset).all()

        execs_by_trade = {}
        open_ids = [t.id for t in trades if t.is_open]
        if open_ids:
            for execution in Execution.query.filter(Execution.matched_trade_id.in_(open_ids)).all():
                execs_by_trade.setdefault(execution.matched_trade_id, []).append(execution)

        payload = []
        for trade in trades:
            data = trade.to_dict()
            if trade.is_open:
                mtm = _mark_open_trade(trade, execs_by_trade.get(trade.id, []))
                data['open_pnl'] = mtm['open_pnl']
            payload.append(data)

        return jsonify({
            'success': True,
            'data': payload,
            'total': total,
            'limit': limit,
            'offset': offset
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>', methods=['GET'])
def get_trade(trade_id):
    """Get a single trade by ID"""
    try:
        trade = Trade.query.get_or_404(trade_id)
        data = trade.to_dict()
        if trade.is_open:
            mtm = _mark_open_trade(trade)
            data['open_pnl'] = mtm['open_pnl']
            data['open_positions'] = mtm['open_positions']
        return jsonify({'success': True, 'data': data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>', methods=['PUT'])
def update_trade(trade_id):
    """Update a trade's editable fields (notes, tags, etc.)"""
    try:
        trade = Trade.query.get_or_404(trade_id)
        data = request.json or {}

        stored_description = trade.description or trade.symbol
        description_changed = (
            'description' in data and data['description'] != stored_description
        )

        allowed_fields = ['notes', 'side', 'description', 'override_auto_description']
        for field in allowed_fields:
            if field in data:
                setattr(trade, field, data[field])

        if description_changed:
            trade.override_auto_description = True

        db.session.commit()
        return jsonify({'success': True, 'data': trade.to_dict(), 'message': 'Trade updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>', methods=['DELETE'])
def delete_trade(trade_id):
    """Delete a trade and unlink all its executions (executions are preserved)"""
    try:
        trade = db.session.get(Trade, trade_id)
        if not trade:
            return jsonify({'success': False, 'error': 'Trade not found'}), 404

        # Get all executions linked to this trade
        entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
        exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
        all_exec_ids = list(set(entry_ids + exit_ids))

        # Unlink executions from this trade (but don't delete them)
        for exec_id in all_exec_ids:
            exec = db.session.get(Execution, exec_id)
            if exec:
                exec.matched_trade_id = None

        # Also clear any orphan executions that point to this trade but aren't in the lists
        orphans = Execution.query.filter_by(matched_trade_id=trade.id).all()
        for exec in orphans:
            exec.matched_trade_id = None

        account_id = trade.account_id

        # Delete the trade
        db.session.delete(trade)
        db.session.commit()

        # Recalculate stats
        recalculate_all_stats()

        return jsonify({
            'success': True,
            'message': f'Trade #{trade_id} deleted. {len(all_exec_ids)} execution(s) unlinked and preserved.'
        })

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/executions', methods=['GET'])
def get_trade_executions(trade_id):
    """Get executions for a specific trade"""
    try:
        trade = Trade.query.get_or_404(trade_id)
        
        # Use the sync helper so we only return executions whose matched_trade_id
        # actually points to this trade.  This filters out stale references left
        # by the old position-reversal bug (and any other linkage drift).
        executions, warnings, conflicts = _sync_and_get_trade_executions(trade)
        
        result = {'success': True, 'data': [e.to_dict() for e in executions]}
        if warnings:
            result['warnings'] = warnings
        if conflicts:
            result['conflicts'] = conflicts
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def _sync_and_get_trade_executions(trade):
    """
    Sync execution linkage for a trade and return all executions linked to it.
    
    1. Fixes ghosts: executions in the trade's JSON lists that have no matched_trade_id
       get linked to this trade.
    2. Detects conflicts: executions in lists already linked to a DIFFERENT trade.
    3. Returns all executions with matched_trade_id = trade.id (includes fixed ghosts + orphans).
    
    Returns: (executions_list, warnings_list, conflicts_list)
    """
    entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
    exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
    list_ids = list(set(entry_ids + exit_ids))
    warnings = []
    conflicts = []
    
    app.logger.debug(f"[SYNC] Trade {trade.id}: entry_ids={entry_ids}, exit_ids={exit_ids}, list_ids={list_ids}")
    
    # Fix ghosts and detect conflicts
    if list_ids:
        list_execs = Execution.query.filter(Execution.id.in_(list_ids)).all()
        found_ids = {e.id for e in list_execs}
        missing_ids = set(list_ids) - found_ids
        if missing_ids:
            warnings.append(f"Execution IDs not found in DB: {sorted(missing_ids)}")
            app.logger.debug(f"[SYNC] Trade {trade.id}: MISSING execution IDs: {sorted(missing_ids)}")
        
        for exec in list_execs:
            if exec.matched_trade_id is None:
                app.logger.debug(f"[SYNC] Trade {trade.id}: Fixing ghost execution {exec.id}")
                exec.matched_trade_id = trade.id
            elif exec.matched_trade_id != trade.id:
                conflict = {
                    'execution_id': exec.id,
                    'symbol': exec.symbol,
                    'current_trade_id': exec.matched_trade_id,
                }
                conflicts.append(conflict)
                app.logger.debug(f"[SYNC] Trade {trade.id}: CONFLICT - execution {exec.id} ({exec.symbol or 'unknown'}) is in trade {exec.matched_trade_id}")
    
    result = Execution.query.filter(Execution.matched_trade_id == trade.id).all()
    app.logger.debug(f"[SYNC] Trade {trade.id}: Returning {len(result)} executions, {len(conflicts)} conflicts")
    return result, warnings, conflicts


def _classify_executions_by_symbol(executions):
    """
    Classify each execution as entry (open) or exit (close) using per-symbol
    position tracking. For multi-symbol trades, each symbol is tracked independently.
    
    Returns a dict: {execution_id: is_open_boolean}
    """
    from collections import defaultdict
    
    # Group by symbol
    by_symbol = defaultdict(list)
    for e in executions:
        by_symbol[e.symbol].append(e)
    
    # Sort each group by datetime, then price descending
    for symbol in by_symbol:
        by_symbol[symbol].sort(
            key=lambda e: (e.exec_datetime or e.trade_date or datetime.min, 
                          -(float(e.price) if e.price is not None else 0))
        )
    
    result = {}
    
    for symbol, symbol_execs in by_symbol.items():
        position_qty = 0
        
        for e in symbol_execs:
            qty = float(e.quantity)
            if e.side == 'SELL' and qty > 0:
                qty = -qty
            elif e.side == 'BUY' and qty < 0:
                qty = abs(qty)
            
            if position_qty == 0:
                # Opening a new position for this symbol
                result[e.id] = True
                position_qty = qty
            else:
                if (position_qty > 0 and qty < 0) or (position_qty < 0 and qty > 0):
                    # Opposite direction - closing
                    result[e.id] = False
                    position_qty += qty
                else:
                    # Same direction - adding to position
                    result[e.id] = True
                    position_qty += qty
    
    return result


def _net_price(exec_list, is_exit=False):
    """Calculate net price for a list of executions.
    
    For entry (is_exit=False):  BUY weighted avg - SELL weighted avg
    For exit  (is_exit=True):   SELL weighted avg - BUY weighted avg
    
    This gives the true net debit/credit for spreads:
    - Long call spread entry (Buy $50 @ $5, Sell $55 @ $2) -> $5 - $2 = $3 debit
    - Short call spread entry (Sell $50 @ $5, Buy $55 @ $2) -> $2 - $5 = -$3 credit
    """
    buy_execs = [e for e in exec_list if e.side == 'BUY']
    sell_execs = [e for e in exec_list if e.side == 'SELL']
    
    buy_qty = sum(abs(float(e.quantity or 0)) for e in buy_execs)
    sell_qty = sum(abs(float(e.quantity or 0)) for e in sell_execs)
    
    buy_avg = (sum(float(e.price or 0) * abs(float(e.quantity or 0)) for e in buy_execs) / buy_qty) if buy_qty > 0 else 0
    sell_avg = (sum(float(e.price or 0) * abs(float(e.quantity or 0)) for e in sell_execs) / sell_qty) if sell_qty > 0 else 0
    
    if is_exit:
        return sell_avg - buy_avg
    return buy_avg - sell_avg


def _calculate_spread_quantity(entry_execs):
    """
    Calculate the correct trade quantity, accounting for spreads.
    
    For single-symbol trades: returns sum of absolute quantities (handles partial fills).
    For multi-symbol trades (spreads): returns GCD of per-symbol quantity sums.
    
    Examples:
        BUY 5 XYZ 100C, SELL 5 XYZ 110C → GCD(5, 5) = 5 (vertical spread)
        SELL 2 XYZ 100C, BUY 4 XYZ 110C, SELL 2 XYZ 120C → GCD(2, 4, 2) = 2 (butterfly)
        BUY 3 XYZ 100C, BUY 2 XYZ 100C (partial fills) → sum = 5 (single symbol)
    """
    from math import gcd
    from functools import reduce
    
    if not entry_execs:
        return 0
    
    # Group by symbol and sum absolute quantities (handles partial fills of same option)
    qty_by_symbol = {}
    for e in entry_execs:
        symbol = e.symbol
        qty = abs(float(e.quantity)) if e.quantity is not None else 0
        qty_by_symbol[symbol] = qty_by_symbol.get(symbol, 0) + qty
    
    if len(qty_by_symbol) <= 1:
        # Single symbol - just return the sum (standard behavior)
        return sum(qty_by_symbol.values())
    
    # Multiple symbols (spread) - use GCD
    quantities = [int(round(q)) for q in qty_by_symbol.values() if round(q) > 0]
    if not quantities:
        return sum(qty_by_symbol.values())
    
    return float(reduce(gcd, quantities))


def _calculate_open_quantity(executions):
    """
    Calculate the open quantity for a trade, accounting for spreads.

    For single-symbol trades: returns the net open position (absolute value).
    For multi-symbol trades (spreads): returns the GCD of per-symbol net open positions.

    This correctly handles partially closed spreads by computing the net
    position remaining in each symbol, then determining how many complete
    spread units are still open.

    Examples:
        BUY 5 A, SELL 2 A → 3 open (single symbol)
        BUY 5 A, SELL 5 B → GCD(5, 5) = 5 (vertical spread)
        BUY 5 A, SELL 5 B, SELL 2 A, BUY 2 B → GCD(3, 3) = 3 (partially closed)
        BUY 2 A, SELL 4 B, BUY 2 C → GCD(2, 4, 2) = 2 (butterfly)
    """
    from math import gcd
    from functools import reduce

    if not executions:
        return 0

    # Normalize quantities by side (BUY positive, SELL negative) and group by symbol
    qty_by_symbol = {}
    for e in executions:
        qty = float(e.quantity) if e.quantity is not None else 0
        if e.side == 'SELL' and qty > 0:
            qty = -qty
        elif e.side == 'BUY' and qty < 0:
            qty = abs(qty)
        qty_by_symbol[e.symbol] = qty_by_symbol.get(e.symbol, 0) + qty

    # Take absolute net positions per symbol
    net_positions = [abs(pos) for pos in qty_by_symbol.values()]

    if len(net_positions) <= 1:
        # Single symbol - return the net open position
        return net_positions[0] if net_positions else 0

    # Multi-symbol trade (spread) - use GCD of absolute net positions
    int_positions = [int(round(p)) for p in net_positions if round(p) > 0]
    if not int_positions:
        return 0

    return float(reduce(gcd, int_positions))


_SINGLE_OPTION_SUFFIX = ' Single Option'


def _strip_single_option_phrase(text):
    """Drop a trailing auto-name 'Single Option' when appending to an existing description."""
    if not text:
        return text
    if text.endswith(_SINGLE_OPTION_SUFFIX):
        return text[:-len(_SINGLE_OPTION_SUFFIX)].rstrip()
    return text


def _opening_executions(executions):
    """Executions that open or add to a position (is_open is not False)."""
    return [e for e in executions if getattr(e, 'is_open', None) is not False]


def _executions_by_datetime(executions):
    return sorted(
        executions,
        key=lambda e: (e.exec_datetime or e.trade_date or datetime.min, e.id or 0),
    )


def _append_description_parts(base, extras):
    """Join a locked description with extra trade descriptions or symbols."""
    parts = []
    for index, value in enumerate((base, *extras)):
        text = (value or '').strip()
        if index > 0:
            text = _strip_single_option_phrase(text)
        if text and text not in parts:
            parts.append(text)
    return ' + '.join(parts) if parts else (base or None)


def _symbol_description(execution):
    """Human-readable label for an execution: the broker-provided symbol
    description when available, falling back to the raw symbol."""
    desc = (execution.description or '').strip()
    return desc or execution.symbol


def _text_has_token(text, token):
    if not text or not token:
        return False
    return re.search(rf'(?<!\w){re.escape(token)}(?!\w)', text, re.IGNORECASE) is not None


def _remove_token(text, token):
    if not text or not token:
        return text or ''
    updated = re.sub(
        rf'(?<!\w){re.escape(token)}(?!\w)',
        ' ',
        text,
        count=1,
        flags=re.IGNORECASE,
    )
    return re.sub(r'\s+', ' ', updated).strip(' +')


def _execution_underlying(execution):
    underlying = (execution.underlying_symbol or '').strip()
    if underlying:
        return underlying
    symbol = (execution.symbol or '').strip()
    return symbol.split()[0] if symbol else ''


def _execution_expiry_text(execution):
    expiry = execution.expiry
    if hasattr(expiry, 'isoformat'):
        return expiry.isoformat()
    return str(expiry) if expiry else ''


def _append_label_for_execution(execution, base_text, known_underlyings, known_expiries):
    """Label for a newly assigned leg.

    Drops the underlying when this trade already has that symbol, and drops
    the expiry when this trade already has that expiry. What remains (strike,
    or the other side of a different symbol or date) is what gets appended.
    """
    raw = _strip_single_option_phrase(_symbol_description(execution) or '')
    if not raw:
        return ''

    underlying = _execution_underlying(execution)
    expiry_text = _execution_expiry_text(execution)
    known = {u.upper() for u in known_underlyings if u}
    same_symbol = bool(underlying) and (
        underlying.upper() in known or _text_has_token(base_text, underlying)
    )
    same_expiry = bool(expiry_text) and (
        expiry_text in known_expiries or expiry_text in (base_text or '')
    )

    text = raw
    if same_symbol:
        text = _remove_token(text, underlying)
    if same_expiry:
        text = _remove_token(text, expiry_text)
    return text.strip(' +')


def _append_new_execution_descriptions(trade, existing_executions, new_executions):
    """Append newly assigned opening legs onto the trade description."""
    existing_opening = _opening_executions(existing_executions)
    known_underlyings = {_execution_underlying(e) for e in existing_opening}
    known_underlyings.discard('')
    if trade.underlying_symbol:
        known_underlyings.add(trade.underlying_symbol.strip())
    known_expiries = {_execution_expiry_text(e) for e in existing_opening}
    known_expiries.discard('')
    if trade.expiry:
        known_expiries.add(_execution_expiry_text(trade))

    running = trade.description or ''
    labels = []
    for execution in new_executions:
        label = _append_label_for_execution(
            execution, running, known_underlyings, known_expiries,
        )
        if not label:
            continue
        labels.append(label)
        running = _append_description_parts(running, [label]) or running
        underlying = _execution_underlying(execution)
        if underlying:
            known_underlyings.add(underlying)
        expiry_text = _execution_expiry_text(execution)
        if expiry_text:
            known_expiries.add(expiry_text)

    if not labels:
        return trade.description
    return _append_description_parts(trade.description or '', labels)


def _recalculate_trade_fields(trade, executions, reclassify=True):
    """
    Shared function to recalculate all trade fields from its executions.
    
    Uses position tracking to classify executions as entry or exit:
    - Executions that open or add to a position are classified as entry.
    - Executions that close (reduce) a position are classified as exit.
    - When position reaches zero, the next execution starts a new position.
    
    This correctly handles partial fills, adding to positions, and round-trips.
    
    Updates the trade object in-place with:
    - entry_price, exit_price (weighted from all legs in each group)
    - side, quantity (from defining leg - highest price in entry group)
    - net_pnl, gross_pnl, total_commissions (from real execution net_cash)
    - entry_date, exit_date (from real execution datetimes)
    - entry_execution_ids, exit_execution_ids (classified by position tracking)
    - symbol, underlying_symbol (aggregated from all executions)
    
    Args:
        trade: Trade model object to update
        executions: List of Execution model objects linked to this trade
        reclassify: If True, reclassify all executions via position tracking.
                    If False, respect existing is_open flags (for manual toggles).
        
    Returns:
        dict with 'success' (bool), 'error' (str, optional), and calculated fields
    """
    import math
    
    def safe_float(value, default=0):
        if value is None:
            return default
        try:
            f = float(value)
            if math.isnan(f) or math.isinf(f):
                return default
            return f
        except (ValueError, TypeError):
            return default
    
    if not executions:
        return {'success': False, 'error': 'No executions provided'}
    
    if reclassify:
        # Compute is_open per symbol before determining trade entry/exit
        is_open_map = _classify_executions_by_symbol(executions)
        for e in executions:
            e.is_open = is_open_map.get(e.id)
    
    # Sort by datetime, then by price descending for deterministic ordering
    executions.sort(key=lambda x: (x.exec_datetime or datetime.min, -safe_float(x.price)))
    
    # Aggregate symbols
    underlying_symbols = sorted(set(
        e.underlying_symbol for e in executions 
        if e.underlying_symbol and e.underlying_symbol.lower() not in ('nan', 'none', 'null', '')
    ))
    combined_underlying = ' / '.join(underlying_symbols) if underlying_symbols else executions[0].underlying_symbol
    
    all_symbols = sorted(set(e.symbol for e in executions if e.symbol))
    all_underlyings = sorted(set(
        e.underlying_symbol for e in executions 
        if e.underlying_symbol and e.underlying_symbol.lower() not in ('nan', 'none', 'null', '')
    ))
    if len(all_symbols) > 1:
        combined_symbol = ' / '.join(all_underlyings) if all_underlyings else executions[0].underlying_symbol
    else:
        combined_symbol = all_symbols[0] if all_symbols else executions[0].symbol
    
    earliest_exec = executions[0]
    
    # Trade entry/exit: opens = entries, closes = exits (disregard symbol grouping)
    entry_execs = [e for e in executions if e.is_open]
    exit_execs = [e for e in executions if not e.is_open]
    
    if not entry_execs:
        return {'success': False, 'error': 'Need at least one entry (open) execution to form a trade'}
    
    # --- Process entry group ---
    exit_qty = sum(abs(safe_float(e.quantity)) for e in exit_execs) if exit_execs else 0
    
    # Use spread-aware quantity calculation (GCD for multi-symbol trades)
    quantity = _calculate_spread_quantity(entry_execs)
    
    # Use spread-aware side determination (net cash for multi-symbol trades)
    side = _determine_trade_side(entry_execs)
    
    # Net prices: split by side and subtract for true spread debit/credit
    avg_entry_price = _net_price(entry_execs, is_exit=False)
    avg_exit_price = _net_price(exit_execs, is_exit=True) if exit_execs else None
    
    # Collect real execution IDs
    entry_exec_ids = list(set(e.id for e in entry_execs))
    exit_exec_ids = list(set(e.id for e in exit_execs))
    
    # P&L from ALL real executions
    total_net_cash = sum(safe_float(e.net_cash) for e in executions)
    total_commissions = sum(safe_float(e.commission) for e in executions)
    net_pnl = total_net_cash
    gross_pnl = net_pnl + total_commissions
    
    # Dates from real executions
    entry_dates = [e.exec_datetime for e in entry_execs if e.exec_datetime]
    exit_dates = [e.exec_datetime for e in exit_execs if e.exec_datetime]
    
    earliest_entry = min(entry_dates) if entry_dates else None
    latest_exit = max(exit_dates) if exit_dates else None
    
    # Determine if trade is open or closed based on actual net position per symbol.
    # A trade is open if any symbol still has a non-zero position after all executions.
    position_by_symbol = {}
    for e in executions:
        qty = safe_float(e.quantity)
        if e.side == 'SELL' and qty > 0:
            qty = -qty
        elif e.side == 'BUY' and qty < 0:
            qty = abs(qty)
        position_by_symbol[e.symbol] = position_by_symbol.get(e.symbol, 0) + qty
    
    is_trade_open = any(abs(pos) > 0.0001 for pos in position_by_symbol.values())
    
    # Update trade object
    trade.symbol = combined_symbol
    trade.underlying_symbol = combined_underlying
    trade.asset_class = earliest_exec.asset_class
    trade.strike = earliest_exec.strike
    trade.expiry = earliest_exec.expiry
    trade.put_call = earliest_exec.put_call
    trade.entry_date = earliest_entry.date() if earliest_entry else earliest_exec.trade_date
    trade.entry_price = avg_entry_price
    trade.quantity = quantity
    trade.side = side
    trade.entry_execution_ids = json.dumps(entry_exec_ids)
    trade.exit_execution_ids = json.dumps(exit_exec_ids)
    trade.account_id = earliest_exec.account_id
    
    # Auto-generate description unless the user locked it
    if not trade.override_auto_description:
        auto_description = _generate_trade_description(executions)
        if auto_description:
            trade.description = auto_description
    
    if is_trade_open:
        # Open trade – leave exit fields and P&L empty / zero
        trade.is_open = True
        trade.exit_date = None
        trade.exit_price = None
        trade.gross_pnl = 0
        trade.total_commissions = 0
        trade.net_pnl = 0
        trade.open_qty = _calculate_open_quantity(executions)
    else:
        # Closed trade – compute final fields
        trade.is_open = False
        trade.exit_date = latest_exit.date() if latest_exit else None
        trade.exit_price = avg_exit_price
        trade.gross_pnl = gross_pnl
        trade.total_commissions = total_commissions
        trade.net_pnl = net_pnl
        trade.open_qty = 0
    
    return {
        'success': True,
        'entry_exec_ids': entry_exec_ids,
        'exit_exec_ids': exit_exec_ids,
    }


@app.route('/api/trades/combine', methods=['POST'])
def combine_trades():
    """Combine multiple trades into a single trade"""
    from models import CombinedTradeHistory
    
    try:
        data = request.get_json()
        trade_ids = data.get('trade_ids', [])
        
        if len(trade_ids) < 2:
            return jsonify({'success': False, 'error': 'At least 2 trades are required to combine'}), 400
        
        # Fetch all trades
        trades = Trade.query.filter(Trade.id.in_(trade_ids)).all()
        
        if len(trades) != len(trade_ids):
            return jsonify({'success': False, 'error': 'One or more trades not found'}), 404
        
        # Validate same account
        account_ids = set(t.account_id for t in trades)
        if len(account_ids) > 1:
            return jsonify({'success': False, 'error': 'All trades must be from the same account'}), 400

        # Identify manual trades (trades with no executions)
        manual_trades = []
        trades_with_execs = []
        for trade in trades:
            entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
            exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
            if not entry_ids and not exit_ids:
                manual_trades.append(trade)
            else:
                trades_with_execs.append(trade)

        # Validate: at most 1 manual trade allowed in a combination
        if len(manual_trades) > 1:
            return jsonify({
                'success': False,
                'error': f'{len(manual_trades)} manually created trades selected. Please select only one manual trade to combine into.'
            }), 400

        # Collect all executions from trades that have them
        all_execution_ids = set()
        trade_executions_map = {}

        for trade in trades_with_execs:
            entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
            exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
            all_ids = list(set(entry_ids + exit_ids))

            all_execution_ids.update(all_ids)
            trade_executions_map[str(trade.id)] = all_ids

        # Also track manual trade in executions map (empty list)
        for trade in manual_trades:
            trade_executions_map[str(trade.id)] = []

        if not all_execution_ids:
            return jsonify({'success': False, 'error': 'No executions found for the selected trades'}), 400
        
        # Fetch all unique executions
        executions = Execution.query.filter(Execution.id.in_(list(all_execution_ids))).all()
        
        if not executions:
            return jsonify({'success': False, 'error': 'No executions found for the selected trades'}), 400
        
        # Determine if we're merging into a manual trade (Option A)
        merging_into_manual = len(manual_trades) == 1
        manual_trade = manual_trades[0] if merging_into_manual else None
        
        # Use the manual trade or create a new Trade object for calculations
        if merging_into_manual:
            combined_trade = manual_trade
        else:
            combined_trade = Trade()

        # If any source trade locked its name, keep that name and append the others.
        if any(t.override_auto_description for t in trades):
            combined_trade.override_auto_description = True
            by_id = {t.id: t for t in trades}
            ordered = [by_id[tid] for tid in trade_ids if by_id.get(tid)]
            locked = [t for t in ordered if t.override_auto_description]
            base_trade = locked[0] if locked else None
            extras = []
            for t in ordered:
                if base_trade is not None and t.id == base_trade.id:
                    continue
                desc = (t.description or '').strip()
                if desc and desc != (t.symbol or '').strip():
                    extras.append(desc)
                else:
                    # Description is empty or just the raw symbol — use the
                    # broker-provided symbol descriptions from the trade's
                    # executions instead.
                    t_exec_ids = set(trade_executions_map.get(str(t.id), []))
                    t_execs = _executions_by_datetime(
                        _opening_executions([e for e in executions if e.id in t_exec_ids])
                    )
                    if t_execs:
                        extras.extend(_symbol_description(e) for e in t_execs)
                    else:
                        extras.append(t.symbol)
            combined_trade.description = _append_description_parts(
                base_trade.description if base_trade else combined_trade.description,
                extras,
            )
        
        # Snapshot tags before recalc/delete. Deleting source trades can drop
        # association rows if tags were only inserted via Core SQL while the
        # ORM collections were loaded.
        source_trade_ids = [t.id for t in trades]
        all_tag_ids = {
            row[0] for row in db.session.execute(
                db.select(trade_tags.c.tag_id).where(
                    trade_tags.c.trade_id.in_(source_trade_ids)
                )
            ).all()
        }

        # Use shared recalculation function (applies netting, calculates all fields)
        calc_result = _recalculate_trade_fields(combined_trade, executions)
        
        if not calc_result['success']:
            return jsonify({'success': False, 'error': calc_result.get('error', 'Calculation failed')}), 400

        entry_exec_ids = calc_result['entry_exec_ids']
        exit_exec_ids = calc_result['exit_exec_ids']
        
        # Store original trades data for undo
        original_trades_data = []
        for trade in trades:
            original_trades_data.append({
                'id': trade.id,
                'symbol': trade.symbol,
                'underlying_symbol': trade.underlying_symbol,
                'asset_class': trade.asset_class,
                'strike': float(trade.strike) if trade.strike else None,
                'expiry': trade.expiry.isoformat() if trade.expiry else None,
                'put_call': trade.put_call,
                'entry_date': trade.entry_date.isoformat() if trade.entry_date else None,
                'exit_date': trade.exit_date.isoformat() if trade.exit_date else None,
                'entry_price': float(trade.entry_price) if trade.entry_price else None,
                'exit_price': float(trade.exit_price) if trade.exit_price else None,
                'quantity': float(trade.quantity) if trade.quantity else None,
                'side': trade.side,
                'gross_pnl': float(trade.gross_pnl) if trade.gross_pnl else 0,
                'total_commissions': float(trade.total_commissions) if trade.total_commissions else 0,
                'net_pnl': float(trade.net_pnl) if trade.net_pnl else 0,
                'entry_execution_ids': json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else [],
                'exit_execution_ids': json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else [],
                'account_id': trade.account_id,
            })
        
        if merging_into_manual:
            # Option A: Manual trade already updated in-place by _recalculate_trade_fields
            pass
        else:
            # Standard behavior: Add the new combined trade to the session
            db.session.add(combined_trade)
            db.session.flush()  # Get the ID
        
        # Update executions to point to combined trade
        for exec in executions:
            exec.matched_trade_id = combined_trade.id
        
        # Create history record for undo
        history = CombinedTradeHistory(
            combined_trade_id=combined_trade.id,
            original_trade_ids=json.dumps([t.id for t in trades]),
            original_trades_data=json.dumps(original_trades_data),
            trade_executions_map=json.dumps(trade_executions_map),
        )
        db.session.add(history)
        
        # Delete original trades (skip the manual trade since we merged into it)
        trades_to_delete = trades_with_execs if merging_into_manual else trades
        for trade in trades_to_delete:
            db.session.delete(trade)

        # Assign tags via the ORM after source trades are gone so the
        # combined trade's association rows are the ones that remain.
        if all_tag_ids:
            combined_trade.tags_list = Tag.query.filter(Tag.id.in_(all_tag_ids)).all()
        
        db.session.commit()
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({
            'success': True,
            'data': combined_trade.to_dict(),
            'message': f'Successfully combined {len(trades)} trades into trade #{combined_trade.id}'
        })
        
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/uncombine', methods=['POST'])
def uncombine_trade(trade_id):
    """Undo a trade combination, restoring original trades"""
    from models import CombinedTradeHistory
    
    try:
        # Find the combine history record
        history = CombinedTradeHistory.query.filter_by(
            combined_trade_id=trade_id,
            is_undone=False
        ).first()
        
        if not history:
            return jsonify({'success': False, 'error': 'No combine history found for this trade or already undone'}), 404
        
        # Load original data
        original_trades_data = json.loads(history.original_trades_data)
        trade_executions_map = json.loads(history.trade_executions_map)
        
        # Get the current combined trade
        combined_trade = db.session.get(Trade, trade_id)
        if not combined_trade:
            return jsonify({'success': False, 'error': 'Combined trade not found'}), 404
        
        # Get current tag associations for the combined trade
        current_tags = []
        if hasattr(combined_trade, 'tags_list'):
            current_tags = [t.id for t in combined_trade.tags_list]
        
        # Restore original trades
        restored_trades = []
        for trade_data in original_trades_data:
            restored_trade = Trade(
                symbol=trade_data['symbol'],
                underlying_symbol=trade_data['underlying_symbol'],
                asset_class=trade_data['asset_class'],
                strike=trade_data['strike'],
                expiry=datetime.fromisoformat(trade_data['expiry']).date() if trade_data['expiry'] else None,
                put_call=trade_data['put_call'],
                entry_date=datetime.fromisoformat(trade_data['entry_date']).date() if trade_data['entry_date'] else None,
                exit_date=datetime.fromisoformat(trade_data['exit_date']).date() if trade_data['exit_date'] else None,
                entry_price=trade_data['entry_price'],
                exit_price=trade_data['exit_price'],
                quantity=trade_data['quantity'],
                side=trade_data['side'],
                gross_pnl=trade_data['gross_pnl'],
                total_commissions=trade_data['total_commissions'],
                net_pnl=trade_data['net_pnl'],
                entry_execution_ids=json.dumps(trade_data['entry_execution_ids']),
                exit_execution_ids=json.dumps(trade_data['exit_execution_ids']),
                account_id=trade_data['account_id'],
            )
            db.session.add(restored_trade)
            db.session.flush()  # Get ID
            restored_trades.append(restored_trade)
            
            # Restore executions to point to this trade
            exec_ids = trade_executions_map.get(str(trade_data['id']), [])
            for exec_id in exec_ids:
                exec = db.session.get(Execution, exec_id)
                if exec:
                    exec.matched_trade_id = restored_trade.id
            
            # Restore tags (copy from combined trade)
            for tag_id in current_tags:
                db.session.execute(
                    trade_tags.insert().values(
                        trade_id=restored_trade.id,
                        tag_id=tag_id
                    )
                )
        
        # Mark history as undone
        history.is_undone = True
        history.undone_at = datetime.utcnow()
        
        # Delete the combined trade
        db.session.delete(combined_trade)
        
        db.session.commit()
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({
            'success': True,
            'message': f'Successfully uncombined trade #{trade_id} into {len(restored_trades)} original trades',
            'data': [t.to_dict() for t in restored_trades]
        })
        
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/unmatch', methods=['POST'])
def unmatch_trade(trade_id):
    """Unmatch a trade, unlinking all executions and deleting the trade"""
    try:
        # Get the trade
        trade = db.session.get(Trade, trade_id)
        if not trade:
            return jsonify({'success': False, 'error': 'Trade not found'}), 404
        
        # Get ALL executions currently matched to this trade (including orphans)
        all_matched_execs = Execution.query.filter(
            Execution.matched_trade_id == trade.id
        ).all()
        
        # Clear matched_trade_id from all executions
        for exec in all_matched_execs:
            exec.matched_trade_id = None
        
        account_id = trade.account_id
        
        # Delete the trade
        db.session.delete(trade)
        db.session.commit()
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({
            'success': True,
            'message': f'Successfully unmatched trade #{trade_id}. {len(all_exec_ids)} executions are now available for re-processing.',
            'executions_unmatched': len(all_exec_ids)
        })
        
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/combine-history', methods=['GET'])
def get_trade_combine_history(trade_id):
    """Get combine history for a trade (to check if it can be uncombined)"""
    from models import CombinedTradeHistory
    
    try:
        # Check if this trade was created by combining
        history = CombinedTradeHistory.query.filter_by(
            combined_trade_id=trade_id,
            is_undone=False
        ).first()
        
        if history:
            return jsonify({
                'success': True,
                'data': {
                    'is_combined': True,
                    'can_uncombine': True,
                    'original_trade_count': len(json.loads(history.original_trade_ids)) if history.original_trade_ids else 0,
                    'combined_at': history.created_at.isoformat() if history.created_at else None,
                }
            })
        
        # Check if any history exists (but undone)
        undone_history = CombinedTradeHistory.query.filter_by(
            combined_trade_id=trade_id,
            is_undone=True
        ).first()
        
        if undone_history:
            return jsonify({
                'success': True,
                'data': {
                    'is_combined': True,
                    'can_uncombine': False,
                    'reason': 'Already uncombined',
                    'combined_at': undone_history.created_at.isoformat() if undone_history.created_at else None,
                    'undone_at': undone_history.undone_at.isoformat() if undone_history.undone_at else None,
                }
            })
        
        return jsonify({
            'success': True,
            'data': {
                'is_combined': False,
                'can_uncombine': False,
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades', methods=['POST'])
def create_trade():
    """Create a new manual trade (optionally with executions to assign later)"""
    try:
        data = request.json or {}
        
        # Validate required fields
        account_id = data.get('account_id')
        if not account_id:
            return jsonify({'success': False, 'error': 'Account ID is required'}), 400
        
        # Verify account exists
        account = db.session.get(Account, account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Account not found'}), 404
        
        description = data.get('description', '').strip()
        
        # Create the trade with minimal data
        trade = Trade(
            account_id=account_id,
            symbol=description or 'MANUAL',
            description=description or None,
            override_auto_description=bool(description),
            underlying_symbol=data.get('underlying_symbol'),
            asset_class=data.get('asset_class'),
            strike=data.get('strike'),
            expiry=datetime.fromisoformat(data['expiry']).date() if data.get('expiry') else None,
            put_call=data.get('put_call'),
            entry_date=datetime.fromisoformat(data['entry_date']).date() if data.get('entry_date') else datetime.utcnow().date(),
            exit_date=datetime.fromisoformat(data['exit_date']).date() if data.get('exit_date') else None,
            entry_price=data.get('entry_price', 0),
            exit_price=data.get('exit_price', 0),
            quantity=data.get('quantity', 0),
            side=data.get('side', 'LONG'),
            gross_pnl=0,
            total_commissions=0,
            net_pnl=0,
            entry_execution_ids=json.dumps([]),
            exit_execution_ids=json.dumps([]),
            notes=data.get('notes'),
        )
        
        db.session.add(trade)
        db.session.commit()
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({
            'success': True, 
            'data': trade.to_dict(), 
            'message': 'Trade created successfully'
        })
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/assign', methods=['POST'])
def assign_executions_to_trade(trade_id):
    """Assign unmatched executions to an existing trade and recalculate P&L"""
    try:
        trade = db.session.get(Trade, trade_id)
        if not trade:
            return jsonify({'success': False, 'error': 'Trade not found'}), 404
        
        data = request.json or {}
        execution_ids = data.get('execution_ids', [])
        
        if not execution_ids:
            return jsonify({'success': False, 'error': 'No execution IDs provided'}), 400
        
        # Fetch executions
        executions = Execution.query.filter(Execution.id.in_(execution_ids)).all()
        
        if len(executions) != len(execution_ids):
            return jsonify({'success': False, 'error': 'Some executions not found'}), 404
        
        # Validate executions are unmatched
        already_matched = [e for e in executions if e.matched_trade_id is not None]
        if already_matched:
            return jsonify({
                'success': False, 
                'error': f'{len(already_matched)} executions are already matched to trades. Unmatch them first.'
            }), 400
        
        # Validate same account
        wrong_account = [e for e in executions if e.account_id != trade.account_id]
        if wrong_account:
            return jsonify({
                'success': False, 
                'error': f'{len(wrong_account)} executions belong to a different account than the trade.'
            }), 400
        
        # Sync existing executions (fix ghosts + include orphans), then add new ones
        existing_execs, _, _ = _sync_and_get_trade_executions(trade)
        
        # Link new executions to this trade
        for exec in executions:
            exec.matched_trade_id = trade.id
        
        # Combine all unique executions
        all_executions = list({e.id: e for e in existing_execs + executions}.values())
        all_executions.sort(key=lambda x: (x.exec_datetime or datetime.min, -float(x.price or 0)))
        
        if not all_executions:
            return jsonify({'success': False, 'error': 'No executions to assign'}), 400
        
        # Compute is_open per symbol before determining trade entry/exit
        is_open_map = _classify_executions_by_symbol(all_executions)
        for e in all_executions:
            e.is_open = is_open_map.get(e.id)
        
        # Trade entry/exit: opens = entries, closes = exits (disregard symbol grouping)
        entry_execs = [e for e in all_executions if e.is_open]
        exit_execs = [e for e in all_executions if not e.is_open]
        
        # Calculate P&L
        entry_net_cash = sum(float(e.net_cash or 0) for e in entry_execs)
        exit_net_cash = sum(float(e.net_cash or 0) for e in exit_execs)
        total_commissions = sum(float(e.commission or 0) for e in all_executions)
        
        net_pnl = entry_net_cash + exit_net_cash
        gross_pnl = net_pnl + total_commissions
        
        # Calculate weighted average prices (net spread prices)
        total_entry_qty = sum(abs(float(e.quantity)) for e in entry_execs)
        total_exit_qty = sum(abs(float(e.quantity)) for e in exit_execs)
        
        avg_entry_price = _net_price(entry_execs, is_exit=False)
        avg_exit_price = _net_price(exit_execs, is_exit=True)
        
        # Side from the initial executions only (earliest date, largest
        # absolute price) so adding executions later never flips it
        side = _determine_trade_side(entry_execs)
        
        # Quantity is the sum of all entry-side (open) executions
        quantity = total_entry_qty
        
        # Get dates
        entry_dates = [e.exec_datetime for e in entry_execs if e.exec_datetime]
        exit_dates = [e.exec_datetime for e in exit_execs if e.exec_datetime]
        
        # Update trade
        first_exec = all_executions[0]
        first_open = entry_execs[0] if entry_execs else first_exec
        all_symbols = sorted(set(e.symbol for e in all_executions if e.symbol))
        all_underlyings = sorted(set(
            e.underlying_symbol for e in all_executions 
            if e.underlying_symbol and e.underlying_symbol.lower() not in ('nan', 'none', 'null', '')
        ))
        if len(all_symbols) > 1:
            trade.symbol = ' / '.join(all_underlyings) if all_underlyings else first_exec.underlying_symbol
        else:
            trade.symbol = all_symbols[0] if all_symbols else first_exec.symbol
        trade.underlying_symbol = first_open.underlying_symbol
        trade.asset_class = first_open.asset_class
        trade.strike = first_open.strike
        trade.expiry = first_open.expiry
        trade.put_call = first_open.put_call
        trade.entry_date = min(entry_dates).date() if entry_dates else first_open.trade_date
        trade.exit_date = max(exit_dates).date() if exit_dates else trade.exit_date
        trade.entry_price = avg_entry_price
        trade.exit_price = avg_exit_price if total_exit_qty > 0 else trade.exit_price
        trade.quantity = quantity
        trade.side = side
        trade.gross_pnl = gross_pnl
        trade.total_commissions = total_commissions
        trade.net_pnl = net_pnl
        trade.entry_execution_ids = json.dumps([e.id for e in entry_execs])
        trade.exit_execution_ids = json.dumps([e.id for e in exit_execs])
        
        opening_to_append = _executions_by_datetime(_opening_executions(executions))
        if opening_to_append:
            trade.description = _append_new_execution_descriptions(
                trade, existing_execs, opening_to_append,
            )
        elif not trade.description:
            trade.description = trade.symbol
        
        # Link executions to trade and refresh whether the position is still open.
        # Description is left as the assign logic set it.
        for exec in executions:
            exec.matched_trade_id = trade.id

        position_by_symbol = {}
        for exec in all_executions:
            qty = float(exec.quantity or 0)
            if exec.side == 'SELL' and qty > 0:
                qty = -qty
            elif exec.side == 'BUY' and qty < 0:
                qty = abs(qty)
            position_by_symbol[exec.symbol] = position_by_symbol.get(exec.symbol, 0) + qty
        trade.is_open = any(abs(pos) > 0.0001 for pos in position_by_symbol.values())
        trade.open_qty = _calculate_open_quantity(all_executions) if trade.is_open else 0
        if not trade.is_open:
            trade.exit_date = max(exit_dates).date() if exit_dates else trade.exit_date

        db.session.commit()
        
        # Recalculate stats
        recalculate_all_stats()
        
        return jsonify({
            'success': True,
            'data': trade.to_dict(),
            'message': f'Assigned {len(executions)} executions to trade #{trade_id}'
        })
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/recalculate-pnl', methods=['POST'])
def recalculate_single_trade_pnl(trade_id):
    """Recalculate P&L and all trade fields from its executions using netting logic"""
    try:
        trade = db.session.get(Trade, trade_id)
        if not trade:
            return jsonify({'success': False, 'error': 'Trade not found'}), 404

        data = request.get_json() or {}
        recalculate_stats = data.get('recalculate_stats', False)
        force_reassign = data.get('force_reassign', False)
        previous_account_id = trade.account_id

        # Sync JSON lists with matched_trade_id, then get all executions for this trade
        executions, sync_warnings, conflicts = _sync_and_get_trade_executions(trade)
        
        # If some executions in the lists are linked to OTHER trades, ask user for confirmation
        if conflicts and not force_reassign:
            return jsonify({
                'success': False,
                'error': f'{len(conflicts)} execution(s) in this trade are linked to other trades',
                'conflicts': conflicts,
                'needs_confirmation': True,
            }), 409
        
        # User confirmed: reassign conflicting executions to this trade
        if conflicts and force_reassign:
            for c in conflicts:
                exec = Execution.query.get(c['execution_id'])
                if exec:
                    old_trade_id = exec.matched_trade_id
                    exec.matched_trade_id = trade.id
                    
                    # Remove execution ID from the old trade's JSON lists
                    if old_trade_id:
                        old_trade = db.session.get(Trade, old_trade_id)
                        if old_trade:
                            old_entry_ids = json.loads(old_trade.entry_execution_ids) if old_trade.entry_execution_ids else []
                            old_exit_ids = json.loads(old_trade.exit_execution_ids) if old_trade.exit_execution_ids else []
                            new_entry_ids = [eid for eid in old_entry_ids if eid != exec.id]
                            new_exit_ids = [eid for eid in old_exit_ids if eid != exec.id]
                            old_trade.entry_execution_ids = json.dumps(new_entry_ids) if new_entry_ids else None
                            old_trade.exit_execution_ids = json.dumps(new_exit_ids) if new_exit_ids else None
                            app.logger.debug(f"[RECALC] Removed execution {exec.id} from trade {old_trade_id} lists")
        
        # Commit linkage fixes FIRST so they persist even if recalc fails
        db.session.commit()
        app.logger.debug(f"[RECALC] Trade {trade_id}: Linkage fixes committed")
        
        # Re-fetch executions after commit to get fresh state
        executions = Execution.query.filter(Execution.matched_trade_id == trade.id).all()
        
        if not executions:
            msg = 'No executions linked to this trade'
            if sync_warnings:
                msg += f". Warnings: {'; '.join(sync_warnings)}"
            return jsonify({'success': False, 'error': msg}), 400

        # Get old values for comparison
        old_net_pnl = float(trade.net_pnl) if trade.net_pnl else 0
        old_gross_pnl = float(trade.gross_pnl) if trade.gross_pnl else 0
        old_commission = float(trade.total_commissions) if trade.total_commissions else 0

        # Use shared recalculation function (applies netting, updates all fields)
        app.logger.debug(f"[RECALC] Trade {trade_id}: Running _recalculate_trade_fields with {len(executions)} executions")
        result = _recalculate_trade_fields(trade, executions)
        app.logger.debug(f"[RECALC] Trade {trade_id}: _recalculate_trade_fields result: success={result['success']}, error={result.get('error', 'none')}")
        
        if not result['success']:
            return jsonify({'success': False, 'error': result.get('error', 'Recalculation failed')}), 400

        db.session.commit()
        app.logger.debug(f"[RECALC] Trade {trade_id}: Recalc committed successfully")

        # Optionally recalculate saved daily stats for this trade's account.
        # Win rate and streaks on the dashboard are computed from the selected
        # account's trades, so they follow this trade without a global rebuild.
        message = f'P&L recalculated for trade #{trade_id}'
        if recalculate_stats:
            for stats_account_id in {previous_account_id, trade.account_id}:
                calculate_daily_stats(account_id=stats_account_id, only_account=True)
            account_name = trade.account.name if trade.account else None
            if account_name:
                message += f'. Stats recalculated for {account_name}.'
            else:
                message += '. Stats recalculated for this trade\'s account.'

        return jsonify({
            'success': True,
            'data': trade.to_dict(),
            'warnings': sync_warnings,
            'changes': {
                'net_pnl': {'old': old_net_pnl, 'new': float(trade.net_pnl) if trade.net_pnl else 0},
                'gross_pnl': {'old': old_gross_pnl, 'new': float(trade.gross_pnl) if trade.gross_pnl else 0},
                'commissions': {'old': old_commission, 'new': float(trade.total_commissions) if trade.total_commissions else 0}
            },
            'message': message
        })

    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/executions/unmatched', methods=['GET'])
def get_unmatched_executions():
    """Get unmatched executions for the execution picker"""
    try:
        account_id = request.args.get('account_id', type=int)
        limit = request.args.get('limit', 500, type=int)
        
        query = Execution.query.filter(
            Execution.matched_trade_id.is_(None),
            Execution.asset_class != 'CASH'
        )
        
        if account_id:
            query = query.filter(Execution.account_id == account_id)
        
        executions = query.order_by(Execution.trade_date.desc()).limit(limit).all()
        
        return jsonify({
            'success': True,
            'data': [e.to_dict() for e in executions]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== CSV Import Routes ====================

def _mapping_to_broker_format(mapping):
    """Convert a BrokerImportMapping into a BrokerFormat-like object for the CSV pipeline."""
    class MappingBrokerFormat:
        def __init__(self, mapping):
            self.id = None
            self.code = 'custom_mapping'
            self.name = mapping.name
            self.column_mappings = mapping.column_mappings
            self.value_mappings = mapping.value_mappings
            self.parser_config = mapping.parser_config
            self.is_active = mapping.is_active
    return MappingBrokerFormat(mapping)


@app.route('/api/import/csv', methods=['POST'])
def import_csv():
    """Import executions from CSV file using account's broker format or a custom mapping"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        
        if not file.filename.endswith('.csv'):
            return jsonify({'success': False, 'error': 'File must be a CSV'}), 400
        
        # Get account_id from form data (required)
        account_id = request.form.get('account_id', type=int)
        if not account_id:
            return jsonify({'success': False, 'error': 'Account ID is required'}), 400
        
        # Get optional broker_format_id or broker_import_mapping_id from form data
        broker_format_id = request.form.get('broker_format_id', type=int)
        broker_import_mapping_id = request.form.get('broker_import_mapping_id', type=int)
        
        # Load account to get default broker format if not specified
        account = db.session.get(Account, account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Account not found'}), 404
        
        broker_format = None
        if broker_format_id:
            broker_format = db.session.get(BrokerFormat, broker_format_id)
        elif broker_import_mapping_id:
            mapping = BrokerImportMapping.query.filter_by(id=broker_import_mapping_id, is_active=True).first()
            if not mapping:
                return jsonify({'success': False, 'error': 'Broker import mapping not found'}), 404
            broker_format = _mapping_to_broker_format(mapping)
        elif account.broker_format_id:
            broker_format = db.session.get(BrokerFormat, account.broker_format_id)
        elif account.broker_import_mapping_id:
            mapping = BrokerImportMapping.query.filter_by(id=account.broker_import_mapping_id, is_active=True).first()
            if mapping:
                broker_format = _mapping_to_broker_format(mapping)
        
        if broker_format is None:
            # Default to IB format if no broker format or mapping set
            broker_format = BrokerFormat.query.filter_by(code='ibkr').first()
        
        file_content = file.read()
        
        # Get selected row indices from frontend (optional)
        selected_row_indices = None
        selected_rows_raw = request.form.get('selected_rows')
        if selected_rows_raw:
            try:
                selected_row_indices = json.loads(selected_rows_raw)
            except json.JSONDecodeError:
                selected_row_indices = None
        
        # Advanced cross-symbol matching by execution timestamp (opt-out from modal).
        # Manual matching imports the executions unmatched and lets the user build trades.
        advanced_matching = request.form.get('advanced_matching', '').lower() == 'true'
        manual_matching = request.form.get('manual_matching', '').lower() == 'true'
        if manual_matching:
            advanced_matching = False
        
        result = process_csv_with_format(
            file_content, file.filename, account_id, broker_format, selected_row_indices,
            advanced_matching=advanced_matching, manual_matching=manual_matching,
        )
        
        if result['success']:
            # Recalculate stats after import
            recalculate_all_stats()
        
        return jsonify(result)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/import/template', methods=['GET'])
def download_template():
    """Download Interactive Brokers CSV template"""
    try:
        from csv_processor import get_sample_csv_template
        template = get_sample_csv_template()
        return send_file(
            io.BytesIO(template.encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name='java_journal_template.csv'
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/import/validate', methods=['POST'])
def validate_csv():
    """Validate a CSV file before import - checks template fit and counts expected executions"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        
        if not file.filename.endswith('.csv'):
            return jsonify({'success': False, 'error': 'File must be a CSV'}), 400
        
        # Get account_id from form data (required)
        account_id = request.form.get('account_id', type=int)
        if not account_id:
            return jsonify({'success': False, 'error': 'Account ID is required'}), 400
        
        # Get optional broker_format_id or broker_import_mapping_id from form data
        broker_format_id = request.form.get('broker_format_id', type=int)
        broker_import_mapping_id = request.form.get('broker_import_mapping_id', type=int)
        
        # Load account to get default broker format if not specified
        account = db.session.get(Account, account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Account not found'}), 404
        
        broker_format = None
        if broker_format_id:
            broker_format = db.session.get(BrokerFormat, broker_format_id)
        elif broker_import_mapping_id:
            mapping = BrokerImportMapping.query.filter_by(id=broker_import_mapping_id, is_active=True).first()
            if not mapping:
                return jsonify({'success': False, 'error': 'Broker import mapping not found'}), 404
            broker_format = _mapping_to_broker_format(mapping)
        elif account.broker_format_id:
            broker_format = db.session.get(BrokerFormat, account.broker_format_id)
        elif account.broker_import_mapping_id:
            mapping = BrokerImportMapping.query.filter_by(id=account.broker_import_mapping_id, is_active=True).first()
            if mapping:
                broker_format = _mapping_to_broker_format(mapping)
        
        if broker_format is None:
            # Default to IB format if no broker format or mapping set
            broker_format = BrokerFormat.query.filter_by(code='ibkr').first()
        
        file_content = file.read()
        
        # Import the validation function
        from csv_processor import validate_csv as validate_csv_func
        
        validation_result = validate_csv_func(file_content, file.filename, account_id, broker_format)
        
        return jsonify({
            'success': True,
            'data': validation_result
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Statistics Routes ====================

@app.route('/api/stats/overall', methods=['GET'])
def get_overall_stats():
    """Get overall trading statistics"""
    try:
        stats = OverallStats.query.first()
        if not stats:
            stats_data = calculate_overall_stats()
        else:
            stats_data = stats.to_dict()
        
        return jsonify({'success': True, 'data': stats_data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stats/daily', methods=['GET'])
def get_daily_stats():
    """Get daily statistics"""
    try:
        # Query parameters
        year = request.args.get('year', type=int)
        month = request.args.get('month', type=int)
        
        query = DailyStats.query
        
        if year and month:
            from calendar import monthrange
            start_date = datetime(year, month, 1).date()
            end_date = datetime(year, month, monthrange(year, month)[1]).date()
            query = query.filter(DailyStats.date >= start_date, DailyStats.date <= end_date)
        
        stats = query.order_by(DailyStats.date.desc()).all()
        
        return jsonify({
            'success': True, 
            'data': [s.to_dict() for s in stats]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stats/hourly', methods=['GET'])
def get_hourly_stats():
    """Get hourly statistics"""
    try:
        stats = HourlyStats.query.order_by(HourlyStats.hour).all()
        return jsonify({'success': True, 'data': [s.to_dict() for s in stats]})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/stats/recalculate', methods=['POST'])
def recalculate_stats():
    """Manually trigger stats recalculation for all or specific account"""
    try:
        data = request.get_json() or {}
        account_id = data.get('account_id')
        
        # Reprocess executions into trades first (for specific account or all)
        process_executions_into_trades(account_id)
        
        # Then recalculate stats
        if account_id:
            # Recalculate only for specific account
            from stats_calculator import calculate_daily_stats_for_account, calculate_hourly_stats_for_account, calculate_overall_stats_for_account
            calculate_daily_stats_for_account(account_id)
            calculate_hourly_stats_for_account(account_id)
            result = calculate_overall_stats_for_account(account_id)
            return jsonify({'success': True, 'data': result, 'message': f'Stats recalculated for account {account_id}'})
        else:
            # Recalculate for all accounts
            result = recalculate_all_stats()
            return jsonify({'success': True, 'data': result, 'message': 'Stats recalculated for all accounts'})
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/recalculate-pnl', methods=['POST'])
def recalculate_trade_pnl_endpoint():
    """
    Recalculate P&L and all trade fields for all existing trades using netting logic.
    Updates trades in-place without deleting them (preserves combined trades).
    """
    try:
        # Get optional account_id filter
        data = request.get_json() or {}
        account_id = data.get('account_id')
        
        # Build query
        query = Trade.query
        if account_id:
            query = query.filter(Trade.account_id == account_id)
        
        trades = query.all()
        total_trades = len(trades)
        
        updated_count = 0
        unchanged_count = 0
        error_count = 0
        total_pnl_diff = 0
        
        for trade in trades:
            try:
                # Sync JSON lists with matched_trade_id, then get all executions for this trade
                executions, sync_warnings, conflicts = _sync_and_get_trade_executions(trade)
                
                # Log conflicts but don't reassign in bulk (user should handle individually)
                if conflicts:
                    for c in conflicts:
                        app.logger.debug(f"[BULK RECALC] Skipping conflicted execution {c['execution_id']} (trade {c['current_trade_id']}) for trade {trade.id}")
                
                if not executions:
                    unchanged_count += 1
                    continue
                
                # Get old values for comparison
                old_net_pnl = float(trade.net_pnl) if trade.net_pnl else 0
                
                # Use shared recalculation function (applies netting, updates all fields)
                result = _recalculate_trade_fields(trade, executions)
                
                if not result['success']:
                    error_count += 1
                    app.logger.debug(f"Error processing trade {trade.id}: {result.get('error', 'Unknown')}")
                    continue
                
                new_net_pnl = float(trade.net_pnl) if trade.net_pnl else 0
                
                # Check if P&L actually changed
                if abs(new_net_pnl - old_net_pnl) < 0.01:
                    unchanged_count += 1
                else:
                    updated_count += 1
                    total_pnl_diff += (new_net_pnl - old_net_pnl)
                
            except Exception as e:
                error_count += 1
                app.logger.debug(f"Error processing trade {trade.id}: {e}")
        
        db.session.commit()
        
        return jsonify({
            'success': True,
            'data': {
                'total_trades': total_trades,
                'updated': updated_count,
                'unchanged': unchanged_count,
                'errors': error_count,
                'total_pnl_diff': round(total_pnl_diff, 2)
            },
            'message': f'Recalculated P&L for {updated_count} trades. Total P&L change: ${total_pnl_diff:.2f}'
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Import History Routes ====================

@app.route('/api/imports', methods=['GET'])
def get_imports():
    """Get all import history"""
    try:
        imports = ImportHistory.query.order_by(ImportHistory.imported_at.desc()).all()
        return jsonify({
            'success': True,
            'data': [i.to_dict() for i in imports]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/imports/<int:import_id>', methods=['DELETE'])
def delete_import(import_id):
    """Delete an import, its executions, associated trades, and recalculate everything"""
    try:
        import_record = ImportHistory.query.get_or_404(import_id)
        
        # Step 1: Find all executions associated with this import
        executions_to_delete = Execution.query.filter_by(import_id=import_id).all()
        execution_ids = [e.id for e in executions_to_delete]
        
        # Step 2: Find and delete trades associated with these executions
        # Check both entry_execution_ids and exit_execution_ids
        all_trades = Trade.query.all()
        trades_to_delete = []
        
        for trade in all_trades:
            try:
                entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
                exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
                
                # If any execution in this trade belongs to the import being deleted
                if any(eid in execution_ids for eid in entry_ids) or any(eid in execution_ids for eid in exit_ids):
                    trades_to_delete.append(trade)
            except:
                continue
        
        # Unlink executions from trades before deleting the trades
        # (executions belonging to other imports must not keep a stale matched_trade_id)
        for trade in trades_to_delete:
            entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
            exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
            for exec_id in set(entry_ids + exit_ids):
                exec = Execution.query.get(exec_id)
                if exec:
                    exec.matched_trade_id = None
            db.session.delete(trade)
        
        # Step 3: Delete the executions
        for execution in executions_to_delete:
            db.session.delete(execution)
        
        # Step 4: Delete the import record
        db.session.delete(import_record)
        
        db.session.commit()
        
        # Step 5: Reprocess remaining executions into trades
        process_executions_into_trades()
        
        # Step 6: Recalculate all stats
        recalculate_all_stats()
        
        return jsonify({
            'success': True, 
            'message': f'Import deleted. Removed {len(executions_to_delete)} executions and {len(trades_to_delete)} trades. Stats recalculated.'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Account Filtering Helpers ====================

def _normalize_account_ids(raw):
    """Normalize an account filter into a list of ints.

    Accepts None, a single int, or an iterable of ints. Returns None when no
    account filter was requested (meaning "all accounts").
    """
    if raw is None:
        return None
    if isinstance(raw, int):
        return [raw]
    ids = []
    for value in raw:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            continue
    return ids or None


def _parse_account_ids_arg(args):
    """Read account filtering params from a request.

    Supports `account_id` (single) and `account_ids` (repeated and/or
    comma-separated). Returns a de-duplicated list of ints, or None when the
    caller asked for all accounts.
    """
    ids = []
    single = args.get('account_id', type=int)
    if single is not None:
        ids.append(single)
    for raw in args.getlist('account_ids'):
        for part in raw.split(','):
            part = part.strip()
            if part.lstrip('-').isdigit():
                ids.append(int(part))
    seen = set()
    unique = []
    for account_id in ids:
        if account_id not in seen:
            seen.add(account_id)
            unique.append(account_id)
    return unique or None


def _account_filter(column, account_ids):
    """Build a filter matching any of the given accounts plus legacy NULL rows."""
    account_ids = _normalize_account_ids(account_ids)
    if not account_ids:
        return None
    return or_(column.in_(account_ids), column.is_(None))


def _summed_account_value(account_ids):
    """Sum the configured starting_account_value across the selected accounts."""
    account_ids = _normalize_account_ids(account_ids)
    if not account_ids:
        return None
    total = None
    for account in Account.query.filter(Account.id.in_(account_ids)).all():
        value = (account.settings or {}).get('starting_account_value')
        if value is None:
            continue
        value = float(value)
        total = value if total is None else total + value
    return total


# ==================== Dashboard Routes ====================

@app.route('/api/dashboard', methods=['GET'])
def get_dashboard_data():
    """Get all dashboard data in one call, filtered by accounts and date range"""
    try:
        # Get filters from query params
        account_ids = _parse_account_ids_arg(request.args)
        start_date_str = request.args.get('start_date')
        end_date_str = request.args.get('end_date')
        year = request.args.get('year', datetime.now().year, type=int)
        month = request.args.get('month', datetime.now().month, type=int)
        exclude_margin_tag = request.args.get('exclude_margin_tag', 'false').lower() == 'true'
        
        # Parse date range for stats/charts
        from calendar import monthrange
        if start_date_str:
            stats_start_date = datetime.fromisoformat(start_date_str).date()
            stats_end_date = datetime.fromisoformat(end_date_str).date() if end_date_str else datetime.now().date()
            use_date_filter = True
        else:
            # No date range specified - use all time (or default to current month if no trades)
            stats_start_date = datetime(year, month, 1).date()
            stats_end_date = datetime(year, month, monthrange(year, month)[1]).date()
            use_date_filter = False
        
        # Calendar shows all dates (last 12 months) but filtered by account
        calendar_end_date = datetime.now().date()
        calendar_start_date = calendar_end_date - timedelta(days=365)
        
        # Build trade query - only closed trades, filter by date range only if specified
        # Include trades where account_id matches OR account_id is NULL (for legacy data)
        if use_date_filter:
            trade_query = Trade.query.filter(
                Trade.is_open == False,
                Trade.exit_date >= stats_start_date,
                Trade.exit_date <= stats_end_date
            )
        else:
            # No date filter - get all closed trades
            trade_query = Trade.query.filter(Trade.is_open == False)
        
        trade_account_filter = _account_filter(Trade.account_id, account_ids)
        if trade_account_filter is not None:
            trade_query = trade_query.filter(trade_account_filter)
        
        trades = trade_query.all()
        
        # Filter out trades tagged with "Margin" if requested
        if exclude_margin_tag and trades:
            # Find the Margin tag
            margin_tag = Tag.query.filter(Tag.name.ilike('margin')).first()
            if margin_tag:
                # Get trade IDs that have the Margin tag
                margin_trade_ids = db.session.query(trade_tags.c.trade_id).filter(
                    trade_tags.c.tag_id == margin_tag.id
                ).all()
                margin_trade_ids = {t[0] for t in margin_trade_ids}
                # Filter out trades with Margin tag
                trades = [t for t in trades if t.id not in margin_trade_ids]
        
        # Use the selected accounts' configured starting values (summed) for the
        # Sharpe calculation
        account_value = _summed_account_value(account_ids)
        
        # Calculate overall stats from filtered trades
        overall_data = calculate_overall_stats_filtered(trades, account_value=account_value) if trades else get_default_stats()
        
        # Daily stats for charts - filtered by accounts AND date range (if specified)
        # Include records where account_id matches OR account_id is NULL (for legacy data)
        if use_date_filter:
            daily_query = DailyStats.query.filter(
                DailyStats.date >= stats_start_date,
                DailyStats.date <= stats_end_date
            )
        else:
            daily_query = DailyStats.query
        daily_account_filter = _account_filter(DailyStats.account_id, account_ids)
        if daily_account_filter is not None:
            daily_query = daily_query.filter(daily_account_filter)
        daily_stats = daily_query.order_by(DailyStats.date).all()
        
        # Calendar data - ALL dates (last 12 months) filtered by accounts only
        calendar_query = DailyStats.query.filter(
            DailyStats.date >= calendar_start_date,
            DailyStats.date <= calendar_end_date
        )
        if daily_account_filter is not None:
            calendar_query = calendar_query.filter(daily_account_filter)
        calendar_stats = calendar_query.order_by(DailyStats.date).all()
        
        # Hourly stats (calculated from filtered executions - date range only if specified)
        if use_date_filter:
            hourly_stats = calculate_hourly_stats_filtered(account_ids, stats_start_date, stats_end_date)
        else:
            hourly_stats = calculate_hourly_stats_filtered(account_ids, None, None)
        
        # Recent trades (filtered by date range and accounts)
        recent_trades = trade_query.order_by(Trade.exit_date.desc()).limit(10).all()
        
        # Recent executions (filtered by date range and accounts)
        # Include records where account_id matches OR account_id is NULL (for legacy data)
        if use_date_filter:
            exec_query = Execution.query.filter(
                Execution.trade_date >= stats_start_date,
                Execution.trade_date <= stats_end_date
            )
        else:
            exec_query = Execution.query
        exec_account_filter = _account_filter(Execution.account_id, account_ids)
        if exec_account_filter is not None:
            exec_query = exec_query.filter(exec_account_filter)
        recent_executions = exec_query.order_by(Execution.trade_date.desc()).limit(10).all()
        
        # Get the last execution date for the selected account(s)
        last_exec_query = db.session.query(func.max(Execution.trade_date).label('max_date'))
        if exec_account_filter is not None:
            last_exec_query = last_exec_query.filter(exec_account_filter)
        last_exec_result = last_exec_query.first()
        last_execution_date = last_exec_result.max_date.isoformat() if last_exec_result and last_exec_result.max_date else None
        
        # Calculate P&L by tags (filtered by date range and accounts ONLY - always show all tags)
        if use_date_filter:
            tag_pnl = calculate_tag_pnl_filtered(account_ids, stats_start_date, stats_end_date, False)
        else:
            tag_pnl = calculate_tag_pnl_filtered(account_ids, None, None, False)
        
        # Calculate duration buckets from filtered trades
        duration_pnl = calculate_duration_buckets(trades)
        
        # Calculate symbol P&L (filtered by date range and accounts)
        symbol_pnl = calculate_symbol_pnl_filtered(account_ids, stats_start_date, stats_end_date, use_date_filter)
        
        # Calculate trade P&L by entry hour (filtered by date range and accounts)
        trade_pnl_by_hour = calculate_trade_pnl_by_hour_filtered(account_ids, stats_start_date, stats_end_date, use_date_filter)
        
        # Get open positions (executions not matched to any trade)
        # Filter by account and optionally by date range
        try:
            open_positions_query = Execution.query.filter(
                Execution.matched_trade_id == None,
                Execution.asset_class != 'CASH'
            )
            if exec_account_filter is not None:
                open_positions_query = open_positions_query.filter(exec_account_filter)
            if use_date_filter:
                open_positions_query = open_positions_query.filter(
                    Execution.trade_date >= stats_start_date,
                    Execution.trade_date <= stats_end_date
                )
            open_executions = open_positions_query.all()
        except Exception as e:
            import traceback
            app.logger.debug(f"ERROR fetching open positions: {e}")
            traceback.print_exc()
            open_executions = []
        
        # Aggregate open positions by symbol
        # Sum quantities and calculate weighted average price
        from collections import defaultdict
        open_positions_by_symbol = defaultdict(lambda: {
            'symbol': '',
            'description': '',
            'asset_class': '',
            'underlying_symbol': '',
            'strike': None,
            'expiry': None,
            'put_call': '',
            'total_quantity': 0,
            'total_cost': 0,  # For weighted avg calculation
            'total_commission': 0,
            'total_net_cash': 0,
            'earliest_date': None,
            'side': '',
            'count': 0
        })
        
        for exec in open_executions:
            key = exec.symbol
            pos = open_positions_by_symbol[key]
            
            if pos['count'] == 0:
                pos['symbol'] = exec.symbol
                pos['description'] = exec.description
                pos['asset_class'] = exec.asset_class
                pos['underlying_symbol'] = exec.underlying_symbol
                pos['strike'] = float(exec.strike) if exec.strike else None
                pos['expiry'] = exec.expiry.isoformat() if exec.expiry else None
                pos['put_call'] = exec.put_call or ''
                pos['side'] = exec.side
            
            # Normalize quantity (positive for BUY, negative for SELL)
            qty = float(exec.quantity) if exec.quantity else 0
            if exec.side == 'SELL' and qty > 0:
                qty = -qty
            elif exec.side == 'BUY' and qty < 0:
                qty = abs(qty)
            
            pos['total_quantity'] += qty
            pos['total_cost'] += qty * float(exec.price) if exec.price else 0
            pos['total_commission'] += float(exec.commission) if exec.commission else 0
            pos['total_net_cash'] += float(exec.net_cash or 0)
            pos['count'] += 1
            
            # Track earliest date
            exec_date = exec.trade_date.isoformat() if exec.trade_date else None
            if exec_date and (pos['earliest_date'] is None or exec_date < pos['earliest_date']):
                pos['earliest_date'] = exec_date
        
        # Calculate average price and format for frontend
        open_positions = []
        quote_service = None
        try:
            quote_service = get_quote_service()
        except Exception as e:
            app.logger.debug(f"WARN: quote service unavailable: {e}")

        for key, pos in open_positions_by_symbol.items():
            if pos['count'] > 0:
                avg_price = abs(pos['total_cost'] / pos['total_quantity']) if pos['total_quantity'] != 0 else 0
                open_pnl = None
                if quote_service and (pos['asset_class'] or '').upper() in ('OPT', 'FOP'):
                    mid = quote_service.lookup_mid(
                        pos['underlying_symbol'] or pos['symbol'],
                        pos['expiry'],
                        pos['put_call'],
                        pos['strike'],
                    )
                    if mid is not None:
                        open_pnl = pos['total_net_cash'] + pos['total_quantity'] * mid * 100.0
                open_positions.append({
                    'id': f"{key}_open",  # Synthetic ID
                    'symbol': pos['symbol'],
                    'description': pos['description'],
                    'asset_class': pos['asset_class'],
                    'underlying_symbol': pos['underlying_symbol'],
                    'strike': pos['strike'],
                    'expiry': pos['expiry'],
                    'put_call': pos['put_call'],
                    'side': pos['side'],
                    'quantity': pos['total_quantity'],
                    'price': avg_price,
                    'open_pnl': open_pnl,
                    'trade_date': pos['earliest_date'],
                    'commission': pos['total_commission'],
                    'execution_count': pos['count'],
                    'type': 'P'
                })
        
        # Find open trades using the is_open flag (consistent with trades page)
        try:
            open_trade_query = Trade.query.filter(
                Trade.is_open == True
            )
            if trade_account_filter is not None:
                open_trade_query = open_trade_query.filter(trade_account_filter)
            open_trade_objs = open_trade_query.all()

            # Use trade's own fields directly - they are already correctly set
            # by csv_processor.py when the trade was created
            for trade in open_trade_objs:
                mtm = _mark_open_trade(trade)
                open_positions.append({
                    'id': trade.id,
                    'symbol': trade.symbol,
                    'description': trade.description or trade.symbol,
                    'asset_class': trade.asset_class,
                    'underlying_symbol': trade.underlying_symbol,
                    'strike': float(trade.strike) if trade.strike else None,
                    'expiry': trade.expiry.isoformat() if trade.expiry else None,
                    'put_call': trade.put_call,
                    'side': trade.side,
                    'quantity': float(trade.quantity) if trade.quantity else 0,
                    'open_qty': float(trade.open_qty) if trade.open_qty else 0,
                    'price': float(trade.entry_price) if trade.entry_price else 0,
                    'open_pnl': mtm['open_pnl'],
                    'trade_date': trade.entry_date.isoformat() if trade.entry_date else None,
                    'commission': float(trade.total_commissions) if trade.total_commissions else 0,
                    'execution_count': 0,
                    'type': 'T',
                    'tags': [t.to_dict() for t in trade.tags_list] if hasattr(trade, 'tags_list') else []
                })
        except Exception as e:
            import traceback
            app.logger.debug(f"ERROR fetching open trades: {e}")
            traceback.print_exc()
        
        # Sort by earliest date descending
        open_positions.sort(key=lambda x: x['trade_date'] or '', reverse=True)
        
        # Count executions per day for calendar data
        exec_count_query = db.session.query(
            Execution.trade_date,
            func.count(Execution.id).label('count')
        ).filter(
            Execution.trade_date >= calendar_start_date,
            Execution.trade_date <= calendar_end_date
        )
        if exec_account_filter is not None:
            exec_count_query = exec_count_query.filter(exec_account_filter)
        exec_counts = {row[0].isoformat(): row[1] for row in exec_count_query.group_by(Execution.trade_date).all()}
        
        calendar_data = []
        for d in calendar_stats:
            d_dict = d.to_dict()
            d_dict['execution_count'] = exec_counts.get(d_dict['date'], 0)
            calendar_data.append(d_dict)
        
        return jsonify({
            'success': True,
            'data': {
                'overall': overall_data,
                'daily': [d.to_dict() for d in daily_stats],
                'calendar': calendar_data,
                'hourly': hourly_stats,
                'recent_trades': [t.to_dict() for t in recent_trades],
                'recent_executions': [e.to_dict() for e in recent_executions],
                'tag_pnl': tag_pnl,
                'duration_pnl': duration_pnl,
                'symbol_pnl': symbol_pnl,
                'trade_pnl_by_hour': trade_pnl_by_hour,
                'open_trades': open_positions,  # Already a list of dicts
                'last_execution_date': last_execution_date,
                'sortino_equity': get_sortino_equity(
                    account_ids,
                    stats_start_date if use_date_filter else None,
                    datetime.fromisoformat(end_date_str).date() if end_date_str else None,
                )
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


def get_default_stats():
    """Return default stats with zeros"""
    return {
        'total_trades': 0,
        'winning_trades': 0,
        'losing_trades': 0,
        'break_even_trades': 0,
        'win_rate': 0,
        'loss_rate': 0,
        'gross_profit': 0,
        'gross_loss': 0,
        'net_pnl': 0,
        'total_commission': 0,
        'avg_win': 0,
        'avg_loss': 0,
        'largest_profit': 0,
        'largest_loss': 0,
        'profit_factor': 0,
        'expectancy': 0,
        'sharpe_ratio': 0,
        'sortino_ratio': 0,
        'calmar_ratio': 0,
        'avg_trade_duration': 0,
        'longest_win_streak': 0,
        'longest_loss_streak': 0,
        'longest_win_streak_amount': 0,
        'longest_loss_streak_amount': 0,
        'current_streak': 0,
        'current_streak_type': 'win',
        'mfe_capture': 0,
        'mae_recovery': 0,
        'efficiency_ratio': 0,
        'avg_risk_reward': 0,
        'exit_gap': 0,
        'left_on_table': 0,
        'good_captures': 0
    }


def calculate_tag_pnl():
    """Calculate P&L grouped by tags (legacy - uses all trades)"""
    return calculate_tag_pnl_filtered(None, None, None)


def calculate_tag_pnl_filtered(account_ids=None, start_date=None, end_date=None, exclude_margin_tag=False):
    """Calculate P&L grouped by tags with optional filters"""
    account_ids = _normalize_account_ids(account_ids)
    try:
        app.logger.debug(f"\n=== calculate_tag_pnl_filtered called ===")
        app.logger.debug(f"  account_ids={account_ids}, start_date={start_date}, end_date={end_date}, exclude_margin_tag={exclude_margin_tag}")
        
        tags = Tag.query.all()
        
        if not tags:
            app.logger.debug("No tags found in database")
            return []
        
        app.logger.debug(f"Found {len(tags)} tags: {[t.name for t in tags]}")
        
        # Build tag lookup
        tag_lookup = {t.id: {'name': t.name, 'color': t.color or '#3b82f6'} for t in tags}
        
        # Find Margin tag ID if needed
        margin_tag_id = None
        if exclude_margin_tag:
            margin_tag = Tag.query.filter(Tag.name.ilike('margin')).first()
            if margin_tag:
                margin_tag_id = margin_tag.id
                app.logger.debug(f"Excluding Margin tag (id={margin_tag_id})")
        
        # Debug: Check if trade_tags table has data
        from sqlalchemy import text
        tag_count = db.session.execute(text("SELECT COUNT(*) FROM trade_tags")).scalar()
        app.logger.debug(f"trade_tags table has {tag_count} associations")
        
        # Debug: Check all tagged trades with account info
        all_tagged = db.session.execute(text("""
            SELECT tt.tag_id, t.account_id, COUNT(*) as count
            FROM trade_tags tt
            JOIN trades t ON tt.trade_id = t.id
            GROUP BY tt.tag_id, t.account_id
        """)).all()
        app.logger.debug(f"All tagged trades by tag and account:")
        for row in all_tagged:
            tag_name = tag_lookup.get(row.tag_id, {}).get('name', f'ID:{row.tag_id}')
            app.logger.debug(f"  {tag_name} (account={row.account_id}): {row.count} trades")
        
        # Build query with filters
        query = db.session.query(
            trade_tags.c.tag_id,
            func.sum(Trade.net_pnl).label('total_pnl'),
            func.count(Trade.id).label('trade_count')
        ).join(
            Trade, trade_tags.c.trade_id == Trade.id
        )
        app.logger.debug(f"  Base query built, joining trade_tags with Trade")
        
        # Apply filters
        if start_date:
            query = query.filter(Trade.exit_date >= start_date)
            app.logger.debug(f"  Filter: exit_date >= {start_date}")
        if end_date:
            query = query.filter(Trade.exit_date <= end_date)
            app.logger.debug(f"  Filter: exit_date <= {end_date}")
        tag_account_filter = _account_filter(Trade.account_id, account_ids)
        if tag_account_filter is not None:
            # Include trades where account_id matches OR is NULL (legacy data)
            query = query.filter(tag_account_filter)
            app.logger.debug(f"  Filter: account_id IN {account_ids} OR NULL")
            
            # Debug: Check how many tagged trades match this account filter
            account_check = db.session.query(func.count(Trade.id)).join(
                trade_tags, trade_tags.c.trade_id == Trade.id
            ).filter(
                trade_tags.c.tag_id == margin_tag_id,
                tag_account_filter,
            ).scalar()
            app.logger.debug(f"  Tagged Margin trades matching account filter: {account_check}")
        
        # Exclude trades tagged with "Margin" if requested
        if exclude_margin_tag and margin_tag_id:
            # Subquery to find trade IDs with Margin tag
            margin_trade_subquery = db.session.query(trade_tags.c.trade_id).filter(
                trade_tags.c.tag_id == margin_tag_id
            ).subquery()
            query = query.filter(~Trade.id.in_(margin_trade_subquery))
        
        result = query.group_by(trade_tags.c.tag_id).all()
        app.logger.debug(f"Tag P&L query returned {len(result)} rows")
        
        # Debug: Show raw SQL
        app.logger.debug(f"  Raw result: {[(r.tag_id, float(r.total_pnl or 0), r.trade_count) for r in result]}")
        
        tag_pnl_list = []
        for row in result:
            app.logger.debug(f"  Tag ID {row.tag_id}: PnL=${row.total_pnl}, Count={row.trade_count}")
            if row.tag_id in tag_lookup:
                tag_pnl_list.append({
                    'tag': tag_lookup[row.tag_id]['name'],
                    'pnl': float(row.total_pnl) if row.total_pnl else 0,
                    'count': row.trade_count,
                    'color': tag_lookup[row.tag_id]['color']
                })
        
        # Sort by absolute P&L (descending)
        tag_pnl_list.sort(key=lambda x: abs(x['pnl']), reverse=True)
        app.logger.debug(f"Returning {len(tag_pnl_list)} tag P&L entries")
        
        return tag_pnl_list
    except Exception as e:
        app.logger.debug(f"Error calculating tag P&L: {e}")
        import traceback
        traceback.print_exc()
        return []


def calculate_symbol_pnl_filtered(account_ids=None, start_date=None, end_date=None, use_date_filter=False):
    """Calculate P&L grouped by underlying symbol with optional filters"""
    account_ids = _normalize_account_ids(account_ids)
    try:
        # Build query with filters - use underlying_symbol instead of symbol
        query = db.session.query(
            Trade.underlying_symbol,
            func.sum(Trade.net_pnl).label('total_pnl'),
            func.count(Trade.id).label('trade_count')
        )
        
        if use_date_filter and start_date and end_date:
            query = query.filter(Trade.exit_date >= start_date, Trade.exit_date <= end_date)
        
        if account_ids:
            query = query.filter((Trade.account_id.in_(account_ids)) | (Trade.account_id == None))
        
        # Filter out trades with no underlying symbol
        query = query.filter(Trade.underlying_symbol.isnot(None))
        
        result = query.group_by(Trade.underlying_symbol).all()
        
        symbol_pnl_list = []
        for row in result:
            symbol_pnl_list.append({
                'symbol': row.underlying_symbol,
                'pnl': float(row.total_pnl) if row.total_pnl else 0,
                'count': row.trade_count
            })
        
        # Sort by absolute P&L (descending)
        symbol_pnl_list.sort(key=lambda x: abs(x['pnl']), reverse=True)
        
        return symbol_pnl_list
    except Exception as e:
        app.logger.debug(f"Error calculating symbol P&L: {e}")
        import traceback
        traceback.print_exc()
        return []


def calculate_trade_pnl_by_hour_filtered(account_ids=None, start_date=None, end_date=None, use_date_filter=False):
    """Calculate trade P&L grouped by entry hour (NY timezone) with optional filters - intraday trades only (< 24hrs)"""
    account_ids = _normalize_account_ids(account_ids)
    try:
        import pytz
        from sqlalchemy import func
        
        # Get the FIRST execution (entry) for each trade by finding minimum exec_datetime per trade
        # This correctly handles both LONG (BUY entry) and SHORT (SELL entry) trades
        ny_tz = pytz.timezone('America/New_York')
        utc_tz = pytz.UTC
        
        # Subquery to get first execution datetime per trade
        first_exec_subquery = db.session.query(
            Execution.matched_trade_id,
            func.min(Execution.exec_datetime).label('first_exec_datetime')
        ).filter(
            Execution.matched_trade_id.isnot(None),
            Execution.exec_datetime.isnot(None)
        ).group_by(
            Execution.matched_trade_id
        ).subquery()
        
        # Join with trades and executions to get the first execution details
        query = db.session.query(
            Trade.id,
            Trade.net_pnl,
            Trade.entry_date,
            Trade.exit_date,
            Execution.exec_datetime
        ).join(
            first_exec_subquery, Trade.id == first_exec_subquery.c.matched_trade_id
        ).join(
            Execution, 
            (Execution.matched_trade_id == first_exec_subquery.c.matched_trade_id) &
            (Execution.exec_datetime == first_exec_subquery.c.first_exec_datetime)
        )
        
        if use_date_filter and start_date and end_date:
            query = query.filter(Trade.exit_date >= start_date, Trade.exit_date <= end_date)
        
        if account_ids:
            query = query.filter((Trade.account_id.in_(account_ids)) | (Trade.account_id == None))
        
        results = query.all()
        
        # Filter to intraday trades only (< 24 hours) and convert to NY timezone
        hourly_data = {}
        processed_trades = set()  # Track processed trade IDs to avoid duplicates
        
        for row in results:
            # Skip if we've already processed this trade (shouldn't happen but safety check)
            if row.id in processed_trades:
                continue
            processed_trades.add(row.id)
            
            exec_datetime = row.exec_datetime
            if exec_datetime is None:
                continue
                
            # Calculate trade duration in hours
            entry_date = row.entry_date
            exit_date = row.exit_date
            if entry_date and exit_date:
                duration_hours = (exit_date - entry_date).total_seconds() / 3600
                # Skip trades > 24 hours
                if duration_hours > 24:
                    continue
            
            # The stored datetimes are already in NY time (naive, no timezone info)
            # Just extract the hour directly without timezone conversion
            if exec_datetime.tzinfo is not None:
                # If somehow has timezone info, convert to NY
                ny_time = exec_datetime.astimezone(ny_tz)
                hour = ny_time.hour
            else:
                # Naive datetime - already in NY time
                hour = exec_datetime.hour
            
            if hour not in hourly_data:
                hourly_data[hour] = {'pnl': 0, 'count': 0}
            
            # Each trade is only counted once with its full P&L
            hourly_data[hour]['pnl'] += float(row.net_pnl) if row.net_pnl else 0
            hourly_data[hour]['count'] += 1
        
        # Convert to list format
        hourly_pnl_list = []
        for hour in sorted(hourly_data.keys()):
            hourly_pnl_list.append({
                'hour': hour,
                'pnl': round(hourly_data[hour]['pnl'], 2),
                'count': hourly_data[hour]['count']
            })
        
        return hourly_pnl_list
    except Exception as e:
        app.logger.debug(f"Error calculating trade P&L by hour: {e}")
        import traceback
        traceback.print_exc()
        return []


def calculate_duration_buckets(trades):
    """Calculate P&L grouped by trade duration buckets"""
    if not trades:
        return []
    
    # Define duration buckets (in minutes)
    # Format: (min_minutes, max_minutes, label)
    buckets = [
        (0, 30, '0-30min'),
        (30, 60, '30min-1hr'),
        (60, 120, '1-2hr'),
        (120, 240, '2-4hr'),
        (240, 480, '4-8hr'),
        (480, 720, '8-12hr'),
        (720, 1440, '12-24hr'),
        (1440, 4320, '1-3days'),
        (4320, 10080, '3-7days'),
        (10080, 43200, '7-30days'),
        (43200, 129600, '30-90days'),
        (129600, float('inf'), '>90days')
    ]
    
    # Initialize bucket data
    bucket_data = {label: {'pnl': 0, 'count': 0} for _, _, label in buckets}
    
    for trade in trades:
        # Calculate duration in minutes from entry/exit datetime or date
        duration_minutes = None
        
        # Try to use entry_datetime and exit_datetime if available
        if hasattr(trade, 'entry_datetime') and hasattr(trade, 'exit_datetime'):
            if trade.entry_datetime and trade.exit_datetime:
                duration_minutes = (trade.exit_datetime - trade.entry_datetime).total_seconds() / 60
        
        # Fallback to entry_date and exit_date
        if duration_minutes is None and trade.entry_date and trade.exit_date:
            # Calculate duration in days, convert to minutes (assume intraday if same day)
            delta = trade.exit_date - trade.entry_date
            duration_minutes = delta.days * 1440  # days to minutes
            
            # If same day, we need more info - default to middle bucket or check executions
            if duration_minutes == 0 and hasattr(trade, 'entry_execution_ids') and trade.entry_execution_ids:
                # Try to get more precise timing from executions
                try:
                    entry_ids = json.loads(trade.entry_execution_ids) if trade.entry_execution_ids else []
                    exit_ids = json.loads(trade.exit_execution_ids) if trade.exit_execution_ids else []
                    
                    if entry_ids and exit_ids:
                        # Use db.session.get() instead of Query.get() to avoid deprecation warning
                        entry_exec = db.session.get(Execution, entry_ids[0])
                        exit_exec = db.session.get(Execution, exit_ids[-1])
                        if entry_exec and exit_exec and entry_exec.exec_datetime and exit_exec.exec_datetime:
                            duration_minutes = (exit_exec.exec_datetime - entry_exec.exec_datetime).total_seconds() / 60
                except:
                    pass
        
        if duration_minutes is None:
            continue  # Skip trades without duration info
        
        # Find the bucket
        for min_min, max_min, label in buckets:
            if min_min <= duration_minutes < max_min:
                bucket_data[label]['pnl'] += float(trade.net_pnl) if trade.net_pnl else 0
                bucket_data[label]['count'] += 1
                break
    
    # Convert to list format for frontend - return all buckets even if empty
    result = []
    for _, _, label in buckets:
        data = bucket_data[label]
        result.append({
            'bucket': label,
            'pnl': round(data['pnl'], 2),
            'count': data['count']
        })
    
    return result


def calculate_overall_stats_filtered(trades, account_value=None):
    """Calculate overall stats from a filtered list of trades.

    account_value: optional starting account value; when provided, the Sharpe
    ratio is computed on returns of a running equity base instead of raw
    dollar P&L.
    """
    import numpy as np
    
    if not trades:
        return get_default_stats()
    
    # Convert to list of dicts for calculations
    trade_data = []
    for t in trades:
        trade_data.append({
            'net_pnl': float(t.net_pnl) if t.net_pnl else 0,
            'gross_pnl': float(t.gross_pnl) if t.gross_pnl else 0,
            'total_commissions': float(t.total_commissions) if t.total_commissions else 0,
            'entry_date': t.entry_date,
            'exit_date': t.exit_date,
            'side': t.side
        })
    
    df = pd.DataFrame(trade_data)
    
    # Basic counts
    total_trades = len(df)
    winning_trades = len(df[df['net_pnl'] > 0])
    losing_trades = len(df[df['net_pnl'] < 0])
    break_even_trades = len(df[df['net_pnl'] == 0])
    
    import math
    
    def safe_float(value, default=0):
        """Convert to float, replacing NaN/Inf with default value"""
        if value is None:
            return default
        try:
            f = float(value)
            if math.isnan(f) or math.isinf(f):
                return default
            return f
        except (ValueError, TypeError):
            return default
    
    win_rate = safe_float((winning_trades / total_trades * 100) if total_trades > 0 else 0)
    loss_rate = safe_float((losing_trades / total_trades * 100) if total_trades > 0 else 0)
    
    # P&L calculations
    gross_profit = safe_float(df[df['gross_pnl'] > 0]['gross_pnl'].sum())
    gross_loss = safe_float(abs(df[df['gross_pnl'] < 0]['gross_pnl'].sum()))
    net_pnl = safe_float(df['net_pnl'].sum())
    total_commission = safe_float(df['total_commissions'].sum())
    
    # Average calculations
    avg_win = safe_float(df[df['net_pnl'] > 0]['net_pnl'].mean() if winning_trades > 0 else 0)
    avg_loss = safe_float(df[df['net_pnl'] < 0]['net_pnl'].mean() if losing_trades > 0 else 0)
    
    # Extremes
    largest_profit = safe_float(df['net_pnl'].max())
    largest_loss = safe_float(df['net_pnl'].min())
    
    # Profit factor
    profit_factor = safe_float(gross_profit / gross_loss if gross_loss != 0 else 0)
    
    # Expectancy
    avg_trade = df['net_pnl'].mean()
    expectancy = safe_float(avg_trade)
    
    # Sharpe Ratio (using daily returns; equity-based when account_value is set)
    df['exit_date'] = pd.to_datetime(df['exit_date'])
    daily_returns = df.groupby(df['exit_date'].dt.date)['net_pnl'].sum()
    
    sharpe_ratio = compute_sharpe_ratio(daily_returns, account_value)
    
    # Sortino Ratio (downside deviation)
    downside_returns = daily_returns[daily_returns < 0]
    if len(downside_returns) > 0 and downside_returns.std() != 0:
        sortino_ratio = safe_float((daily_returns.mean() / downside_returns.std()) * np.sqrt(252))
    else:
        sortino_ratio = 0
    
    # Calmar Ratio
    cumulative = daily_returns.cumsum()
    running_max = cumulative.expanding().max()
    drawdown = cumulative - running_max
    max_drawdown = abs(drawdown.min()) if len(drawdown) > 0 else 0
    
    annual_return = safe_float(daily_returns.mean() * 252)
    calmar_ratio = safe_float(annual_return / max_drawdown if max_drawdown != 0 else 0)
    
    # Trade duration
    df['entry_date'] = pd.to_datetime(df['entry_date'])
    df['duration_days'] = (df['exit_date'] - df['entry_date']).dt.days
    avg_trade_duration = safe_float(df['duration_days'].mean() if 'duration_days' in df.columns else 0)
    
    # Streak analysis - based on DAILY net P&L (not individual trades)
    daily_pnl = df.groupby(df['exit_date'].dt.date)['net_pnl'].sum().sort_index()
    
    longest_win_streak = 0
    longest_loss_streak = 0
    current_win_streak = 0
    current_loss_streak = 0
    current_win_streak_amount = 0
    current_loss_streak_amount = 0
    longest_win_streak_amount = 0
    longest_loss_streak_amount = 0
    
    for daily_net in daily_pnl:
        if daily_net > 0:  # Profitable day
            current_win_streak += 1
            current_win_streak_amount += daily_net
            current_loss_streak = 0
            current_loss_streak_amount = 0
            if current_win_streak > longest_win_streak:
                longest_win_streak = current_win_streak
                longest_win_streak_amount = current_win_streak_amount
        elif daily_net < 0:  # Losing day
            current_loss_streak += 1
            current_loss_streak_amount += daily_net
            current_win_streak = 0
            current_win_streak_amount = 0
            if current_loss_streak > longest_loss_streak:
                longest_loss_streak = current_loss_streak
                longest_loss_streak_amount = current_loss_streak_amount
        else:  # Break-even day (net_pnl == 0) - resets both streaks
            current_win_streak = 0
            current_loss_streak = 0
            current_win_streak_amount = 0
            current_loss_streak_amount = 0
    
    current_streak = current_win_streak if current_win_streak > 0 else current_loss_streak
    current_streak_type = 'win' if current_win_streak > 0 else 'loss'
    
    return {
        'total_trades': total_trades,
        'winning_trades': winning_trades,
        'losing_trades': losing_trades,
        'break_even_trades': break_even_trades,
        'win_rate': win_rate,
        'loss_rate': loss_rate,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
        'net_pnl': net_pnl,
        'total_commission': total_commission,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'largest_profit': largest_profit,
        'largest_loss': largest_loss,
        'profit_factor': profit_factor,
        'expectancy': expectancy,
        'sharpe_ratio': sharpe_ratio,
        'sortino_ratio': sortino_ratio,
        'calmar_ratio': calmar_ratio,
        'avg_trade_duration': int(avg_trade_duration) if avg_trade_duration else 0,
        'longest_win_streak': longest_win_streak,
        'longest_loss_streak': longest_loss_streak,
        'longest_win_streak_amount': longest_win_streak_amount,
        'longest_loss_streak_amount': longest_loss_streak_amount,
        'current_streak': current_streak,
        'current_streak_type': current_streak_type,
        'mfe_capture': 0,
        'mae_recovery': 0,
        'efficiency_ratio': 0,
        'avg_risk_reward': 0,
        'exit_gap': 0,
        'left_on_table': 0,
        'good_captures': 0
    }


def calculate_hourly_stats_filtered(account_ids=None, start_date=None, end_date=None):
    """Calculate hourly stats from filtered executions"""
    account_ids = _normalize_account_ids(account_ids)
    try:
        query = Execution.query.filter(Execution.exec_datetime.isnot(None))
        
        if start_date:
            query = query.filter(Execution.trade_date >= start_date)
        if end_date:
            query = query.filter(Execution.trade_date <= end_date)
        if account_ids:
            # Include executions where account_id matches OR is NULL (legacy data)
            query = query.filter((Execution.account_id.in_(account_ids)) | (Execution.account_id == None))
        
        executions = query.all()
        
        if not executions:
            return []
        
        df = pd.DataFrame([e.to_dict() for e in executions])
        df['net_cash'] = df['net_cash'].astype(float)
        df['exec_datetime'] = pd.to_datetime(df['exec_datetime'])
        df['hour'] = df['exec_datetime'].dt.hour
        
        # Group by hour
        hourly = df.groupby('hour').agg({
            'net_cash': ['count', 'sum', 'mean'],
        }).reset_index()
        
        hourly.columns = ['hour', 'total_trades', 'net_pnl', 'avg_pnl']
        
        hourly_stats = []
        for idx, row in hourly.iterrows():
            hour = int(row['hour'])
            hour_execs = df[df['hour'] == hour]
            winning_trades = len(hour_execs[hour_execs['net_cash'] > 0])
            
            # Handle NaN values
            avg_pnl_val = row['avg_pnl']
            if pd.isna(avg_pnl_val):
                avg_pnl_val = 0
            
            hourly_stats.append({
                'hour': hour,
                'total_trades': int(row['total_trades']),
                'winning_trades': winning_trades,
                'net_pnl': float(row['net_pnl']),
                'avg_pnl': float(avg_pnl_val)
            })
        
        return hourly_stats
    except Exception as e:
        app.logger.debug(f"Error calculating hourly stats: {e}")
        return []


# ==================== Chart Data Routes ====================

@app.route('/api/charts/equity', methods=['GET'])
def get_equity_curve():
    """Get equity curve data"""
    try:
        daily_stats = DailyStats.query.order_by(DailyStats.date).all()
        
        equity = 0
        equity_data = []
        for stat in daily_stats:
            equity += stat.net_pnl
            equity_data.append({
                'date': stat.date.isoformat(),
                'pnl': float(stat.net_pnl),
                'equity': float(equity)
            })
        
        return jsonify({'success': True, 'data': equity_data})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/charts/pnl-distribution', methods=['GET'])
def get_pnl_distribution():
    """Get P&L distribution data"""
    try:
        trades = Trade.query.filter(Trade.is_open == False).all()
        pnl_values = [float(t.net_pnl) for t in trades]
        
        # Create histogram bins
        if pnl_values:
            import numpy as np
            bins = np.histogram_bin_edges(pnl_values, bins=20)
            hist, _ = np.histogram(pnl_values, bins=bins)
            
            distribution = []
            for i in range(len(hist)):
                distribution.append({
                    'bin_start': float(bins[i]),
                    'bin_end': float(bins[i+1]),
                    'count': int(hist[i])
                })
        else:
            distribution = []
        
        return jsonify({'success': True, 'data': distribution})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Symbol Routes ====================

@app.route('/api/symbols', methods=['GET'])
def get_symbols():
    """Get all unique symbols"""
    try:
        symbols = db.session.query(Execution.symbol).distinct().all()
        return jsonify({
            'success': True, 
            'data': [s[0] for s in symbols if s[0]]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/underlyings', methods=['GET'])
def get_underlyings():
    """Get all unique underlying symbols"""
    try:
        underlyings = db.session.query(Execution.underlying_symbol).distinct().all()
        return jsonify({
            'success': True, 
            'data': [u[0] for u in underlyings if u[0]]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Account Routes ====================

@app.route('/api/accounts', methods=['GET'])
def get_accounts():
    """Get accounts. Inactive accounts are omitted unless include_inactive=true."""
    try:
        include_inactive = request.args.get('include_inactive', '').lower() in ('1', 'true', 'yes')
        query = Account.query
        if not include_inactive:
            query = query.filter_by(is_active=True)
        accounts = query.order_by(Account.is_active.desc(), Account.name).all()
        return jsonify({
            'success': True,
            'data': [a.to_dict() for a in accounts]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/accounts', methods=['POST'])
def create_account():
    """Create a new account"""
    try:
        data = request.json
        account = Account(
            name=data['name'],
            broker=data.get('broker'),
            account_number=data.get('account_number'),
            description=data.get('description'),
            broker_format_id=data.get('broker_format_id'),
            broker_import_mapping_id=data.get('broker_import_mapping_id'),
            timezone=data.get('timezone', 'America/New_York'),
            settings=data.get('settings', {})
        )
        db.session.add(account)
        db.session.commit()
        return jsonify({'success': True, 'data': account.to_dict(), 'message': 'Account created'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/accounts/<int:account_id>', methods=['PUT'])
def update_account(account_id):
    """Update an account"""
    try:
        account = Account.query.get_or_404(account_id)
        data = request.json
        if 'name' in data:
            account.name = data['name']
        if 'broker' in data:
            account.broker = data['broker']
        if 'account_number' in data:
            account.account_number = data['account_number']
        if 'description' in data:
            account.description = data['description']
        if 'is_active' in data:
            account.is_active = data['is_active']
        if 'broker_format_id' in data:
            account.broker_format_id = data['broker_format_id']
        if 'broker_import_mapping_id' in data:
            account.broker_import_mapping_id = data['broker_import_mapping_id']
        if 'timezone' in data:
            account.timezone = data['timezone']
        if 'settings' in data:
            account.settings = data['settings']
        db.session.commit()
        return jsonify({'success': True, 'data': account.to_dict(), 'message': 'Account updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/accounts/<int:account_id>', methods=['DELETE'])
def delete_account(account_id):
    """Delete (deactivate) an account"""
    try:
        account = Account.query.get_or_404(account_id)
        account.is_active = False
        db.session.commit()
        return jsonify({'success': True, 'message': 'Account deactivated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Broker Format Routes ====================

@app.route('/api/broker-formats', methods=['GET'])
def get_broker_formats():
    """Get all active broker formats"""
    try:
        formats = BrokerFormat.query.filter_by(is_active=True).order_by(BrokerFormat.name).all()
        return jsonify({
            'success': True,
            'data': [f.to_dict() for f in formats]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/broker-formats/<int:format_id>', methods=['GET'])
def get_broker_format(format_id):
    """Get a specific broker format"""
    try:
        format = BrokerFormat.query.get_or_404(format_id)
        return jsonify({
            'success': True,
            'data': format.to_dict()
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Tag Routes ====================

@app.route('/api/tags', methods=['GET'])
def get_tags():
    """Get all tags"""
    try:
        tags = Tag.query.order_by(Tag.name).all()
        return jsonify({
            'success': True,
            'data': [t.to_dict() for t in tags]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/tags', methods=['POST'])
def create_tag():
    """Create a new tag"""
    try:
        data = request.json
        tag = Tag(
            name=data['name'],
            color=data.get('color', '#3b82f6'),
            description=data.get('description')
        )
        db.session.add(tag)
        db.session.commit()
        return jsonify({'success': True, 'data': tag.to_dict(), 'message': 'Tag created'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/tags/<int:tag_id>', methods=['PUT'])
def update_tag(tag_id):
    """Update a tag"""
    try:
        tag = Tag.query.get_or_404(tag_id)
        data = request.json
        if 'name' in data:
            tag.name = data['name']
        if 'color' in data:
            tag.color = data['color']
        if 'description' in data:
            tag.description = data['description']
        db.session.commit()
        return jsonify({'success': True, 'data': tag.to_dict(), 'message': 'Tag updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/tags/<int:tag_id>', methods=['DELETE'])
def delete_tag(tag_id):
    """Delete a tag"""
    try:
        tag = Tag.query.get_or_404(tag_id)
        db.session.delete(tag)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Tag deleted'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/tags', methods=['GET'])
def get_trade_tags(trade_id):
    """Get tags for a specific trade"""
    try:
        trade = Trade.query.get_or_404(trade_id)
        tags = trade.tags_list
        return jsonify({'success': True, 'data': [t.to_dict() for t in tags]})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/trades/<int:trade_id>/tags', methods=['PUT'])
def set_trade_tags(trade_id):
    """Set tags for a specific trade (replaces all existing tags)"""
    try:
        trade = Trade.query.get_or_404(trade_id)
        data = request.json
        tag_ids = data.get('tag_ids', [])
        
        # Get tag objects
        tags = Tag.query.filter(Tag.id.in_(tag_ids)).all() if tag_ids else []
        
        # Replace tags
        trade.tags_list = tags
        db.session.commit()
        
        return jsonify({'success': True, 'data': [t.to_dict() for t in tags], 'message': 'Tags updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Journal Routes ====================

@app.route('/api/journals', methods=['GET'])
def get_journals():
    """Get all journals in a date range (without full content for list view)"""
    try:
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        query = DailyJournal.query
        
        if start_date:
            query = query.filter(DailyJournal.date >= datetime.fromisoformat(start_date).date())
        if end_date:
            query = query.filter(DailyJournal.date <= datetime.fromisoformat(end_date).date())
        
        journals = query.order_by(DailyJournal.date.desc()).all()
        
        # Return lightweight version without full HTML content
        data = []
        for j in journals:
            data.append({
                'id': j.id,
                'date': j.date.isoformat() if j.date else None,
                'has_content': bool(j.content and len(j.content) > 0),
                'content_preview': j.content_text[:200] if j.content_text else '',
                'created_at': j.created_at.isoformat() if j.created_at else None,
                'updated_at': j.updated_at.isoformat() if j.updated_at else None
            })
        
        return jsonify({
            'success': True,
            'data': data
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/journal/<date>', methods=['GET'])
def get_journal(date):
    """Get a single journal entry by date"""
    try:
        journal_date = datetime.fromisoformat(date).date()
        journal = DailyJournal.query.options(
            joinedload(DailyJournal.event_tags_list)
        ).filter_by(date=journal_date).first()
        
        if journal:
            return jsonify({'success': True, 'data': journal.to_dict()})
        else:
            return jsonify({'success': True, 'data': None})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/journal', methods=['POST'])
def save_journal():
    """Create or update a journal entry"""
    try:
        data = request.json
        journal_date = datetime.fromisoformat(data['date']).date()
        
        journal = DailyJournal.query.filter_by(date=journal_date).first()
        
        if journal:
            # Update existing
            journal.content = data.get('content', '')
            journal.content_text = data.get('content_text', '')
        else:
            # Create new
            journal = DailyJournal(
                date=journal_date,
                content=data.get('content', ''),
                content_text=data.get('content_text', '')
            )
            db.session.add(journal)
        
        # Handle event tags
        event_tag_ids = data.get('event_tag_ids', [])
        if event_tag_ids is not None:
            # Get tag objects
            event_tags = EventTag.query.filter(EventTag.id.in_(event_tag_ids)).all() if event_tag_ids else []
            # Replace tags
            journal.event_tags_list = event_tags
        
        db.session.commit()
        
        return jsonify({'success': True, 'data': journal.to_dict()})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/journal/<date>', methods=['DELETE'])
def delete_journal(date):
    """Delete a journal entry"""
    try:
        journal_date = datetime.fromisoformat(date).date()
        journal = DailyJournal.query.filter_by(date=journal_date).first()
        
        if journal:
            db.session.delete(journal)
            db.session.commit()
            return jsonify({'success': True, 'message': 'Journal deleted'})
        else:
            return jsonify({'success': False, 'error': 'Journal not found'}), 404
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Event Tag Routes ====================

@app.route('/api/event-tags', methods=['GET'])
def get_event_tags():
    """Get all event tags"""
    try:
        tags = EventTag.query.order_by(EventTag.name).all()
        return jsonify({
            'success': True,
            'data': [t.to_dict() for t in tags]
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/event-tags', methods=['POST'])
def create_event_tag():
    """Create a new event tag"""
    try:
        data = request.json
        tag = EventTag(
            name=data['name'].strip(),
            color=data.get('color', '#3b82f6'),
            description=data.get('description', '').strip()
        )
        db.session.add(tag)
        db.session.commit()
        return jsonify({'success': True, 'data': tag.to_dict(), 'message': 'Event tag created'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/event-tags/<int:tag_id>', methods=['PUT'])
def update_event_tag(tag_id):
    """Update an event tag"""
    try:
        tag = EventTag.query.get_or_404(tag_id)
        data = request.json
        if 'name' in data:
            tag.name = data['name'].strip()
        if 'color' in data:
            tag.color = data['color']
        if 'description' in data:
            tag.description = data['description'].strip()
        db.session.commit()
        return jsonify({'success': True, 'data': tag.to_dict(), 'message': 'Event tag updated'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/event-tags/<int:tag_id>', methods=['DELETE'])
def delete_event_tag(tag_id):
    """Delete an event tag"""
    try:
        tag = EventTag.query.get_or_404(tag_id)
        db.session.delete(tag)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Event tag deleted'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Error Handlers ====================

@app.errorhandler(404)
def not_found(error):
    return jsonify({'success': False, 'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return jsonify({'success': False, 'error': 'Internal server error'}), 500


@app.route('/api/accounts/<int:account_id>/reprocess', methods=['POST'])
def reprocess_account_trades(account_id):
    """
    Full reprocess of an account: delete all trades, unlink all executions, 
    reprocess into new trades, and recalculate stats.
    """
    try:
        # Verify account exists
        account = db.session.get(Account, account_id)
        if not account:
            return jsonify({'success': False, 'error': 'Account not found'}), 404
        
        # Get counts before deletion for reporting
        trade_count = Trade.query.filter(
            (Trade.account_id == account_id) | (Trade.account_id == None)
        ).count()
        
        exec_count = Execution.query.filter(
            (Execution.account_id == account_id) | (Execution.account_id == None)
        ).count()
        
        # Step 1: Delete all trades for this account
        deleted_trades = Trade.query.filter(
            (Trade.account_id == account_id) | (Trade.account_id == None)
        ).delete(synchronize_session=False)
        
        # Step 2: Unlink all executions for this account
        Execution.query.filter(
            (Execution.account_id == account_id) | (Execution.account_id == None)
        ).update({'matched_trade_id': None}, synchronize_session=False)
        
        db.session.commit()
        
        # Step 3: Reprocess executions into trades
        from csv_processor import process_executions_into_trades
        trade_summary = process_executions_into_trades(account_id)
        
        # Step 4: Recalculate stats for this account
        from stats_calculator import calculate_daily_stats_for_account, calculate_hourly_stats_for_account, calculate_overall_stats_for_account
        calculate_daily_stats_for_account(account_id)
        calculate_hourly_stats_for_account(account_id)
        calculate_overall_stats_for_account(account_id)
        
        # Get new trade count
        new_trade_count = Trade.query.filter(
            (Trade.account_id == account_id) | (Trade.account_id == None)
        ).count()
        
        response_data = {
            'success': True,
            'message': f'Account {account.name} reprocessed successfully',
            'data': {
                'account_id': account_id,
                'account_name': account.name,
                'trades_before': deleted_trades,
                'trades_after': new_trade_count,
                'executions_processed': exec_count
            }
        }
        if trade_summary:
            response_data['data']['trade_processing'] = trade_summary
        
        return jsonify(response_data)
        
    except Exception as e:
        db.session.rollback()
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ==================== Broker Import Mapping Routes ====================

@app.route('/api/broker-import-mappings', methods=['GET'])
def get_all_broker_import_mappings():
    """Get all global broker import mappings."""
    try:
        mappings = BrokerImportMapping.query.filter_by(is_active=True).order_by(
            BrokerImportMapping.name
        ).all()
        return jsonify({'success': True, 'data': [m.to_dict() for m in mappings]})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/broker-import-mappings', methods=['POST'])
def create_broker_import_mapping():
    """Create a new global broker import mapping."""
    try:
        data = request.json or {}
        name = data.get('name', '').strip()
        if not name:
            return jsonify({'success': False, 'error': 'Mapping name is required'}), 400
        mapping = BrokerImportMapping(
            name=name,
            column_mappings=json.dumps(data.get('column_mappings', {})),
            value_mappings=json.dumps(data.get('value_mappings', {})),
            parser_config=json.dumps(data.get('parser_config', {})),
            is_active=True
        )
        db.session.add(mapping)
        db.session.commit()
        return jsonify({
            'success': True,
            'data': mapping.to_dict(),
            'message': 'Mapping created'
        })
    except Exception as e:
        db.session.rollback()
        error_message = str(e)
        # Provide a friendly message for the known schema-migration issue
        if 'account_id' in error_message and 'not-null' in error_message.lower():
            error_message = (
                'The database still requires an account_id for broker import mappings. '
                'Please run the updated migration in backend/migrations/add_broker_import_mappings.sql '
                'to remove the old account_id column.'
            )
        app.logger.debug(f"ERROR creating broker import mapping: {error_message}")
        return jsonify({'success': False, 'error': error_message}), 500


@app.route('/api/broker-import-mappings/<int:mapping_id>', methods=['PUT'])
def update_broker_import_mapping(mapping_id):
    """Update a broker import mapping."""
    try:
        mapping = BrokerImportMapping.query.filter_by(
            id=mapping_id, is_active=True
        ).first_or_404()
        data = request.json or {}
        if 'name' in data:
            name = data['name'].strip()
            if not name:
                return jsonify({'success': False, 'error': 'Mapping name is required'}), 400
            mapping.name = name
        if 'column_mappings' in data:
            mapping.column_mappings = json.dumps(data['column_mappings'])
        if 'value_mappings' in data:
            mapping.value_mappings = json.dumps(data['value_mappings'])
        if 'parser_config' in data:
            mapping.parser_config = json.dumps(data['parser_config'])
        if 'is_active' in data:
            mapping.is_active = data['is_active']
        db.session.commit()
        return jsonify({
            'success': True,
            'data': mapping.to_dict(),
            'message': 'Mapping updated'
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/broker-import-mappings/<int:mapping_id>', methods=['DELETE'])
def delete_broker_import_mapping(mapping_id):
    """Delete (deactivate) a broker import mapping."""
    try:
        mapping = BrokerImportMapping.query.filter_by(
            id=mapping_id, is_active=True
        ).first_or_404()
        mapping.is_active = False
        db.session.commit()
        return jsonify({'success': True, 'message': 'Mapping deleted'})
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


def _detect_header_row(df, max_rows=10):
    """
    Heuristic to detect the header row in a raw CSV dataframe.
    Returns the index of the row that looks most like a header.
    Defaults to 0 if no clear header is found.
    """
    if df.empty:
        return 0
    check_rows = min(max_rows, len(df))
    best_idx = 0
    best_score = -1
    for idx in range(check_rows):
        row = df.iloc[idx]
        non_empty = [str(v).strip() for v in row if pd.notna(v) and str(v).strip()]
        if not non_empty:
            continue
        # Prefer rows with mostly non-numeric, non-date strings
        numeric_count = 0
        for val in non_empty:
            try:
                float(val.replace(',', ''))
                numeric_count += 1
            except (ValueError, TypeError):
                pass
        text_ratio = 1 - (numeric_count / len(non_empty))
        score = text_ratio * len(non_empty)
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx


def _suggest_column_mappings(csv_headers):
    """Suggest Java Journal field mappings based on CSV header names."""
    suggestions = {}
    jj_field_aliases = {
        'symbol': ['symbol', 'sym', 'ticker', 'underlying', 'instrument'],
        'side': ['side', 'action', 'type', 'transaction', 'buy/sell'],
        'quantity': ['quantity', 'qty', 'shares', 'size'],
        'price': ['price', 'avg price', 'fill price', 'price per share'],
        'trade_date': ['trade date', 'date', 'transaction date', 'settle date'],
        'exec_datetime': ['exec datetime', 'execution time', 'time', 'datetime', 'date/time'],
        'commission': ['commission', 'comm', 'commission/fee'],
        'net_cash': ['net cash', 'net amount', 'amount', 'proceeds'],
        'underlying_symbol': ['underlying symbol', 'underlying'],
        'asset_class': ['asset class', 'type'],
        'strike': ['strike', 'strike price'],
        'expiry': ['expiry', 'expiration', 'expiration date'],
        'put_call': ['put/call', 'put call', 'pc', 'type'],
        'multiplier': ['multiplier'],
        'currency': ['currency', 'cur'],
        'description': ['description', 'desc'],
        'order_id': ['order id', 'orderID'],
        'exec_id': ['exec id', 'execution id'],
    }
    lower_headers = {h: h.lower().strip() for h in csv_headers}
    for jj_field, aliases in jj_field_aliases.items():
        for header in csv_headers:
            lower_header = lower_headers[header]
            if any(alias == lower_header or lower_header.startswith(alias + ' ') for alias in aliases):
                suggestions[jj_field] = header
                break
    return suggestions


@app.route('/api/broker-import-mappings/preview', methods=['POST'])
def preview_broker_import_mapping_file():
    """Preview a CSV file for mapping: headers, sample rows, and suggested mappings."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        file_content = file.read()
        # Try common encodings
        for encoding in ['utf-8', 'latin1', 'cp1252']:
            try:
                text = file_content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            return jsonify({'success': False, 'error': 'Could not decode file'}), 400
        # Read raw rows without header to detect header row
        raw_df = pd.read_csv(io.StringIO(text), header=None, dtype=str, keep_default_na=False)
        header_row_index = _detect_header_row(raw_df)
        # Now read with the detected header
        df = pd.read_csv(io.StringIO(text), header=header_row_index, dtype=str, keep_default_na=False)
        headers = list(df.columns)
        sample_rows = {}
        for header in headers:
            values = df[header].head(5).tolist()
            sample_rows[header] = values
        suggestions = _suggest_column_mappings(headers)
        return jsonify({
            'success': True,
            'data': {
                'headers': headers,
                'header_row_index': header_row_index,
                'sample_rows': sample_rows,
                'suggested_mappings': suggestions
            }
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 7777))
    app.run(host='127.0.0.1', port=port, debug=False)
