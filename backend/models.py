from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()

class Execution(db.Model):
    """Raw execution data from Interactive Brokers CSV format"""
    __tablename__ = 'executions'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Account Info
    client_account_id = db.Column(db.String(50))
    account_alias = db.Column(db.String(100))
    
    # Instrument Info
    symbol = db.Column(db.String(255), nullable=False, index=True)
    description = db.Column(db.String(200))
    asset_class = db.Column(db.String(20))  # OPT, STK, etc.
    underlying_symbol = db.Column(db.String(20))
    
    # Option Specific
    strike = db.Column(db.Numeric(15, 4))
    expiry = db.Column(db.Date)
    put_call = db.Column(db.String(5))  # C or P
    multiplier = db.Column(db.Numeric(10, 2), default=100)
    
    # Trade Details
    trade_id = db.Column(db.String(50), index=True)
    order_id = db.Column(db.String(50))
    exec_id = db.Column(db.String(100))
    transaction_type = db.Column(db.String(50))  # BookTrade, ExchTrade
    
    # Order Details
    side = db.Column(db.String(10), nullable=False)  # BUY or SELL
    quantity = db.Column(db.Numeric(15, 4), nullable=False)
    price = db.Column(db.Numeric(15, 4), nullable=False)
    
    # Financials
    amount = db.Column(db.Numeric(15, 4))  # Raw amount (quantity * price * multiplier)
    proceeds = db.Column(db.Numeric(15, 4))  # Proceeds from trade
    net_cash = db.Column(db.Numeric(15, 4))  # Net cash impact
    
    # Commissions
    commission = db.Column(db.Numeric(15, 4), default=0)  # Total commission
    broker_execution_commission = db.Column(db.Numeric(15, 4), default=0)
    commission_currency = db.Column(db.String(10))
    currency = db.Column(db.String(10))  # Primary currency of the trade (e.g., USD)
    
    # Entry/Exit classification (for journal display)
    is_open = db.Column(db.Boolean, nullable=True)
    
    # Trade matching
    matched_trade_id = db.Column(db.Integer, db.ForeignKey('trades.id'), nullable=True)
    
    # Account and Import
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'))
    import_id = db.Column(db.Integer, db.ForeignKey('import_history.id'), nullable=True)
    
    # Relationships
    account = db.relationship('Account', foreign_keys=[account_id])
    
    # Timestamps
    trade_date = db.Column(db.Date, nullable=False, index=True)
    exec_datetime = db.Column(db.DateTime)  # Date/Time from CSV
    order_time = db.Column(db.DateTime)
    settle_date = db.Column(db.Date)
    
    # Exchange Info
    exchange = db.Column(db.String(50))
    
    notes = db.Column(db.Text)
    
    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        # Get account name - try relationship first, then query if needed
        account_name = None
        if hasattr(self, 'account') and self.account:
            account_name = self.account.name
        
        # If account relationship not loaded but account_id exists, try to get name
        # from the joined Account in the query (if outerjoin was used)
        if not account_name and self.account_id:
            # Check if account was loaded via outerjoin (Account table columns would be prefixed)
            # This is a fallback for when the relationship isn't set up
            pass  # account_name remains None, will use fallback below
        
        # Fallback: use account_alias as account_name if account_name is not set
        if not account_name and self.account_alias:
            account_name = self.account_alias
        
        return {
            'id': self.id,
            'client_account_id': self.client_account_id,
            'account_alias': self.account_alias,
            'account_name': account_name,
            'symbol': self.symbol,
            'description': self.description,
            'asset_class': self.asset_class,
            'underlying_symbol': self.underlying_symbol,
            'strike': float(self.strike) if self.strike else None,
            'expiry': self.expiry.isoformat() if self.expiry else None,
            'put_call': self.put_call,
            'multiplier': float(self.multiplier) if self.multiplier else 100,
            'trade_id': self.trade_id,
            'order_id': self.order_id,
            'exec_id': self.exec_id,
            'transaction_type': self.transaction_type,
            'side': self.side,
            'quantity': float(self.quantity) if self.quantity else None,
            'price': float(self.price) if self.price else None,
            'amount': float(self.amount) if self.amount else None,
            'proceeds': float(self.proceeds) if self.proceeds else None,
            'net_cash': float(self.net_cash) if self.net_cash else None,
            'commission': float(self.commission) if self.commission else 0,
            'broker_execution_commission': float(self.broker_execution_commission) if self.broker_execution_commission else 0,
            'commission_currency': self.commission_currency,
            'currency': self.currency,
            'trade_date': self.trade_date.isoformat() if self.trade_date else None,
            'exec_datetime': self.exec_datetime.isoformat() if self.exec_datetime else None,
            'order_time': self.order_time.isoformat() if self.order_time else None,
            'settle_date': self.settle_date.isoformat() if self.settle_date else None,
            'exchange': self.exchange,
            'notes': self.notes,
            'account_id': self.account_id,
            'import_id': self.import_id,
            'matched_trade_id': self.matched_trade_id,
            'is_open': self.is_open,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class Position(db.Model):
    """Track open positions for P&L calculation"""
    __tablename__ = 'positions'
    
    id = db.Column(db.Integer, primary_key=True)
    symbol = db.Column(db.String(255), nullable=False, index=True)
    underlying_symbol = db.Column(db.String(20), index=True)
    
    # Option details
    strike = db.Column(db.Numeric(15, 4))
    expiry = db.Column(db.Date)
    put_call = db.Column(db.String(5))
    
    # Position tracking
    open_quantity = db.Column(db.Numeric(15, 4), default=0)  # Positive for long, negative for short
    avg_entry_price = db.Column(db.Numeric(15, 4))
    total_cost = db.Column(db.Numeric(15, 4), default=0)
    total_commissions = db.Column(db.Numeric(15, 4), default=0)
    
    # Metadata
    first_entry_date = db.Column(db.Date)
    last_update_date = db.Column(db.Date)
    is_open = db.Column(db.Boolean, default=True)
    
    # Relationships
    executions = db.relationship('Execution', secondary='position_executions', backref='positions')
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Association table for positions and executions
position_executions = db.Table('position_executions',
    db.Column('position_id', db.Integer, db.ForeignKey('positions.id'), primary_key=True),
    db.Column('execution_id', db.Integer, db.ForeignKey('executions.id'), primary_key=True)
)


class Trade(db.Model):
    """Completed round-trip trades (calculated from executions)"""
    __tablename__ = 'trades'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # Instrument Info
    symbol = db.Column(db.String(255), nullable=False, index=True)
    underlying_symbol = db.Column(db.String(20), index=True)
    asset_class = db.Column(db.String(20))
    
    # Option Details
    strike = db.Column(db.Numeric(15, 4))
    expiry = db.Column(db.Date)
    put_call = db.Column(db.String(5))
    
    # Trade Details
    entry_date = db.Column(db.Date, nullable=False)
    exit_date = db.Column(db.Date)
    
    entry_price = db.Column(db.Numeric(15, 4), nullable=False)
    exit_price = db.Column(db.Numeric(15, 4))
    quantity = db.Column(db.Numeric(15, 4), nullable=False)
    
    # Side (LONG or SHORT)
    side = db.Column(db.String(10), nullable=False)
    
    # P&L
    gross_pnl = db.Column(db.Numeric(15, 4), default=0)
    total_commissions = db.Column(db.Numeric(15, 4), default=0)
    net_pnl = db.Column(db.Numeric(15, 4), default=0)
    
    # Related executions
    entry_execution_ids = db.Column(db.Text)  # JSON array of execution IDs
    exit_execution_ids = db.Column(db.Text)  # JSON array of execution IDs
    
    # Open position tracking (continuous trade model)
    is_open = db.Column(db.Boolean, default=True)
    open_qty = db.Column(db.Numeric(15, 4), default=0)
    
    # Account
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'))
    account = db.relationship('Account', backref='trades')
    
    # Description (user-editable, auto-populated from symbol)
    description = db.Column(db.Text)
    override_auto_description = db.Column(db.Boolean, nullable=False, default=False)
    
    # Notes / Journal
    notes = db.Column(db.Text)
    
    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        # Get account name
        account_name = self.account.name if self.account else None
        
        # Get entry/exit times and net cash from executions if available
        entry_time = None
        exit_time = None
        net_cash = 0.0

        if self.entry_execution_ids:
            try:
                entry_ids = json.loads(self.entry_execution_ids)
                if entry_ids:
                    # Get earliest entry execution time
                    entry_execs = Execution.query.filter(Execution.id.in_(entry_ids)).all()
                    if entry_execs:
                        earliest = min((e.exec_datetime for e in entry_execs if e.exec_datetime), default=None)
                        if earliest:
                            entry_time = earliest.isoformat()
                        net_cash += sum(float(e.net_cash or 0) for e in entry_execs)
            except:
                pass

        if self.exit_execution_ids:
            try:
                exit_ids = json.loads(self.exit_execution_ids)
                if exit_ids:
                    # Get latest exit execution time
                    exit_execs = Execution.query.filter(Execution.id.in_(exit_ids)).all()
                    if exit_execs:
                        latest = max((e.exec_datetime for e in exit_execs if e.exec_datetime), default=None)
                        if latest:
                            exit_time = latest.isoformat()
                        net_cash += sum(float(e.net_cash or 0) for e in exit_execs)
            except:
                pass
        
        return {
            'id': self.id,
            'symbol': self.symbol,
            'description': self.description or self.symbol,
            'override_auto_description': bool(self.override_auto_description),
            'underlying_symbol': self.underlying_symbol,
            'asset_class': self.asset_class,
            'strike': float(self.strike) if self.strike else None,
            'expiry': self.expiry.isoformat() if self.expiry else None,
            'put_call': self.put_call,
            'entry_date': self.entry_date.isoformat() if self.entry_date else None,
            'exit_date': self.exit_date.isoformat() if self.exit_date else None,
            'entry_time': entry_time,
            'exit_time': exit_time,
            'entry_price': float(self.entry_price) if self.entry_price is not None else None,
            'exit_price': float(self.exit_price) if self.exit_price is not None else None,
            'quantity': float(self.quantity) if self.quantity is not None else None,
            'side': self.side,
            'gross_pnl': float(self.gross_pnl) if self.gross_pnl else 0,
            'total_commissions': float(self.total_commissions) if self.total_commissions else 0,
            'net_pnl': float(self.net_pnl) if self.net_pnl else 0,
            'net_cash': net_cash,
            'entry_execution_ids': json.loads(self.entry_execution_ids) if self.entry_execution_ids else [],
            'exit_execution_ids': json.loads(self.exit_execution_ids) if self.exit_execution_ids else [],
            'is_open': self.is_open,
            'open_qty': float(self.open_qty) if self.open_qty else 0,
            'tags': [t.to_dict() for t in self.tags_list] if hasattr(self, 'tags_list') else [],
            'notes': self.notes,
            'account_id': self.account_id,
            'account_name': account_name,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }


class DailyStats(db.Model):
    __tablename__ = 'daily_stats'
    
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False)
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'), nullable=True)
    
    # Unique constraint: one record per date per account
    __table_args__ = (
        db.UniqueConstraint('date', 'account_id', name='uix_daily_stats_date_account'),
        db.Index('ix_daily_stats_date_account', 'date', 'account_id'),
    )
    total_trades = db.Column(db.Integer, default=0)
    winning_trades = db.Column(db.Integer, default=0)
    losing_trades = db.Column(db.Integer, default=0)
    break_even_trades = db.Column(db.Integer, default=0)
    gross_pnl = db.Column(db.Numeric(15, 4), default=0)
    net_pnl = db.Column(db.Numeric(15, 4), default=0)
    total_commission = db.Column(db.Numeric(15, 4), default=0)
    largest_profit = db.Column(db.Numeric(15, 4), default=0)
    largest_loss = db.Column(db.Numeric(15, 4), default=0)
    avg_trade_pnl = db.Column(db.Numeric(15, 4), default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
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
        
        return {
            'id': self.id,
            'date': self.date.isoformat() if self.date else None,
            'account_id': self.account_id,
            'total_trades': self.total_trades,
            'winning_trades': self.winning_trades,
            'losing_trades': self.losing_trades,
            'break_even_trades': self.break_even_trades,
            'gross_pnl': safe_float(self.gross_pnl),
            'net_pnl': safe_float(self.net_pnl),
            'total_commission': safe_float(self.total_commission),
            'largest_profit': safe_float(self.largest_profit),
            'largest_loss': safe_float(self.largest_loss),
            'avg_trade_pnl': safe_float(self.avg_trade_pnl)
        }


class OverallStats(db.Model):
    __tablename__ = 'overall_stats'
    
    id = db.Column(db.Integer, primary_key=True)
    total_trades = db.Column(db.Integer, default=0)
    winning_trades = db.Column(db.Integer, default=0)
    losing_trades = db.Column(db.Integer, default=0)
    break_even_trades = db.Column(db.Integer, default=0)
    win_rate = db.Column(db.Numeric(5, 2), default=0)
    loss_rate = db.Column(db.Numeric(5, 2), default=0)
    gross_profit = db.Column(db.Numeric(15, 4), default=0)
    gross_loss = db.Column(db.Numeric(15, 4), default=0)
    net_pnl = db.Column(db.Numeric(15, 4), default=0)
    total_commission = db.Column(db.Numeric(15, 4), default=0)
    avg_win = db.Column(db.Numeric(15, 4), default=0)
    avg_loss = db.Column(db.Numeric(15, 4), default=0)
    largest_profit = db.Column(db.Numeric(15, 4), default=0)
    largest_loss = db.Column(db.Numeric(15, 4), default=0)
    profit_factor = db.Column(db.Numeric(8, 2), default=0)
    expectancy = db.Column(db.Numeric(15, 4), default=0)
    sharpe_ratio = db.Column(db.Numeric(8, 2), default=0)
    sortino_ratio = db.Column(db.Numeric(8, 2), default=0)
    calmar_ratio = db.Column(db.Numeric(8, 2), default=0)
    avg_trade_duration = db.Column(db.Integer, default=0)
    longest_win_streak = db.Column(db.Integer, default=0)
    longest_loss_streak = db.Column(db.Integer, default=0)
    current_streak = db.Column(db.Integer, default=0)
    current_streak_type = db.Column(db.String(10))
    # MAE/MFE fields
    mfe_capture = db.Column(db.Numeric(5, 2), default=0)
    mae_recovery = db.Column(db.Numeric(5, 2), default=0)
    efficiency_ratio = db.Column(db.Numeric(5, 2), default=0)
    # Additional fields from frontend
    avg_risk_reward = db.Column(db.Numeric(8, 2), default=0)
    exit_gap = db.Column(db.Numeric(15, 4), default=0)
    left_on_table = db.Column(db.Numeric(15, 4), default=0)
    good_captures = db.Column(db.Numeric(5, 2), default=0)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
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
        
        return {
            'id': self.id,
            'total_trades': self.total_trades,
            'winning_trades': self.winning_trades,
            'losing_trades': self.losing_trades,
            'break_even_trades': self.break_even_trades,
            'win_rate': safe_float(self.win_rate),
            'loss_rate': safe_float(self.loss_rate),
            'gross_profit': safe_float(self.gross_profit),
            'gross_loss': safe_float(self.gross_loss),
            'net_pnl': safe_float(self.net_pnl),
            'total_commission': safe_float(self.total_commission),
            'avg_win': safe_float(self.avg_win),
            'avg_loss': safe_float(self.avg_loss),
            'largest_profit': safe_float(self.largest_profit),
            'largest_loss': safe_float(self.largest_loss),
            'profit_factor': safe_float(self.profit_factor),
            'expectancy': safe_float(self.expectancy),
            'sharpe_ratio': safe_float(self.sharpe_ratio),
            'sortino_ratio': safe_float(self.sortino_ratio),
            'calmar_ratio': safe_float(self.calmar_ratio),
            'avg_trade_duration': self.avg_trade_duration,
            'longest_win_streak': self.longest_win_streak,
            'longest_loss_streak': self.longest_loss_streak,
            'current_streak': self.current_streak,
            'current_streak_type': self.current_streak_type,
            'mfe_capture': safe_float(self.mfe_capture),
            'mae_recovery': safe_float(self.mae_recovery),
            'efficiency_ratio': safe_float(self.efficiency_ratio),
            'avg_risk_reward': safe_float(self.avg_risk_reward),
            'exit_gap': safe_float(self.exit_gap),
            'left_on_table': safe_float(self.left_on_table),
            'good_captures': safe_float(self.good_captures),
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class HourlyStats(db.Model):
    __tablename__ = 'hourly_stats'
    
    id = db.Column(db.Integer, primary_key=True)
    hour = db.Column(db.Integer, nullable=False)
    total_trades = db.Column(db.Integer, default=0)
    winning_trades = db.Column(db.Integer, default=0)
    net_pnl = db.Column(db.Numeric(15, 4), default=0)
    avg_pnl = db.Column(db.Numeric(15, 4), default=0)
    
    def to_dict(self):
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
        
        return {
            'id': self.id,
            'hour': self.hour,
            'total_trades': self.total_trades,
            'winning_trades': self.winning_trades,
            'net_pnl': safe_float(self.net_pnl),
            'avg_pnl': safe_float(self.avg_pnl)
        }


# Tag association table
trade_tags = db.Table('trade_tags',
    db.Column('trade_id', db.Integer, db.ForeignKey('trades.id', ondelete='CASCADE'), primary_key=True),
    db.Column('tag_id', db.Integer, db.ForeignKey('trade_tags_list.id', ondelete='CASCADE'), primary_key=True),
    db.Column('created_at', db.DateTime, default=datetime.utcnow),
    db.Column('updated_at', db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
)


class Tag(db.Model):
    __tablename__ = 'trade_tags_list'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    color = db.Column(db.String(7), default='#3b82f6')
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship to trades
    trades = db.relationship('Trade', secondary=trade_tags, backref='tags_list')
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'color': self.color,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class User(db.Model):
    __tablename__ = 'users'
    __table_args__ = (db.CheckConstraint('id = 1', name='ck_users_single_owner'),)
    
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(100))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class BrokerFormat(db.Model):
    __tablename__ = 'broker_formats'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    code = db.Column(db.String(50), nullable=False, unique=True)
    description = db.Column(db.Text)
    column_mappings = db.Column(db.Text)  # JSON mapping of field names to CSV column names
    parser_config = db.Column(db.Text)    # JSON config for parsing (date formats, etc)
    value_mappings = db.Column(db.Text)   # JSON value translations (e.g., BUY_TO_OPEN -> BUY)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'code': self.code,
            'description': self.description,
            'column_mappings': json.loads(self.column_mappings) if self.column_mappings else {},
            'parser_config': json.loads(self.parser_config) if self.parser_config else {},
            'value_mappings': json.loads(self.value_mappings) if self.value_mappings else {},
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class BrokerImportMapping(db.Model):
    """User-defined global CSV column/value mapping template for imports."""
    __tablename__ = 'broker_import_mappings'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    column_mappings = db.Column(db.Text)  # JSON: { jj_field: csv_header }
    value_mappings = db.Column(db.Text)   # JSON: { jj_field: { csv_value: jj_value } }
    parser_config = db.Column(db.Text)    # JSON: { header_row_index, date_format, datetime_format, ... }
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'column_mappings': json.loads(self.column_mappings) if self.column_mappings else {},
            'value_mappings': json.loads(self.value_mappings) if self.value_mappings else {},
            'parser_config': json.loads(self.parser_config) if self.parser_config else {},
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class Account(db.Model):
    __tablename__ = 'accounts'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    broker = db.Column(db.String(100))
    account_number = db.Column(db.String(50))
    description = db.Column(db.Text)
    broker_format_id = db.Column(db.Integer, db.ForeignKey('broker_formats.id'), nullable=True)
    broker_import_mapping_id = db.Column(db.Integer, db.ForeignKey('broker_import_mappings.id'), nullable=True)
    # Timezone for this account's trade data (default to Eastern Time for US markets)
    timezone = db.Column(db.String(50), default='America/New_York')
    is_active = db.Column(db.Boolean, default=True)
    # Account-specific settings stored as JSON (e.g., sortino_target)
    settings = db.Column(db.JSON, default=dict)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    broker_format = db.relationship('BrokerFormat', foreign_keys=[broker_format_id])
    broker_import_mapping = db.relationship('BrokerImportMapping', foreign_keys=[broker_import_mapping_id])
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'broker': self.broker,
            'account_number': self.account_number,
            'description': self.description,
            'broker_format_id': self.broker_format_id,
            'broker_import_mapping_id': self.broker_import_mapping_id,
            'timezone': self.timezone,
            'is_active': self.is_active,
            'settings': self.settings or {},
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class ImportHistory(db.Model):
    __tablename__ = 'import_history'
    
    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('accounts.id'))
    account = db.relationship('Account', backref='import_history')
    broker_format_id = db.Column(db.Integer, db.ForeignKey('broker_formats.id'), nullable=True)
    filename = db.Column(db.String(255))
    file_size = db.Column(db.Integer)
    executions_count = db.Column(db.Integer, default=0)
    status = db.Column(db.String(20), default='success')
    error_message = db.Column(db.Text)
    imported_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'account_id': self.account_id,
            'account_name': self.account.name if self.account else None,
            'broker_format_id': self.broker_format_id,
            'filename': self.filename,
            'file_size': self.file_size,
            'executions_count': self.executions_count,
            'status': self.status,
            'error_message': self.error_message,
            'imported_at': self.imported_at.isoformat() if self.imported_at else None
        }


class CombinedTradeHistory(db.Model):
    """Track combined trades for undo capability"""
    __tablename__ = 'combined_trade_history'
    
    id = db.Column(db.Integer, primary_key=True)
    
    # The combined trade that was created
    combined_trade_id = db.Column(db.Integer, db.ForeignKey('trades.id', ondelete='CASCADE'), nullable=False)
    
    # JSON array of original trade IDs that were combined (for undo)
    original_trade_ids = db.Column(db.Text, nullable=False)
    
    # Store the full trade data needed to recreate original trades
    original_trades_data = db.Column(db.Text, nullable=False)
    
    # Track which executions belonged to which original trade
    # Format: {"trade_id_1": [exec_id_1, exec_id_2], "trade_id_2": [...]}
    trade_executions_map = db.Column(db.Text, nullable=False)
    
    # Flag to track if this combine has been undone
    is_undone = db.Column(db.Boolean, default=False)
    undone_at = db.Column(db.DateTime, nullable=True)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'combined_trade_id': self.combined_trade_id,
            'original_trade_ids': json.loads(self.original_trade_ids) if self.original_trade_ids else [],
            'is_undone': self.is_undone,
            'undone_at': self.undone_at.isoformat() if self.undone_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
