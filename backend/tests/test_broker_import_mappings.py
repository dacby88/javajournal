#!/usr/bin/env python3
"""Tests for global BrokerImportMapping backend APIs and import pipeline."""

import os
import sys
import json
import io

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ['DATABASE_URL'] = 'sqlite:///:memory:'

from app import app, db
from models import Account, BrokerImportMapping


def _csv_content():
    return (
        "Ticker,Action,Shares,Fill Price,Trade Date,Commission\n"
        "AAPL,BUY,10,150.00,2026-01-15,1.00\n"
        "TSLA,SELL,5,200.00,2026-01-16,1.50\n"
    ).encode('utf-8')


def test_preview_endpoint():
    with app.app_context():
        db.create_all()

        client = app.test_client()
        response = client.post(
            '/api/broker-import-mappings/preview',
            data={'file': (io.BytesIO(_csv_content()), 'trades.csv')},
            content_type='multipart/form-data'
        )
        assert response.status_code == 200, response.data
        data = response.get_json()
        assert data['success'] is True
        preview = data['data']
        assert preview['headers'] == ['Ticker', 'Action', 'Shares', 'Fill Price', 'Trade Date', 'Commission']
        assert preview['header_row_index'] == 0
        assert 'AAPL' in preview['sample_rows']['Ticker']
        assert preview['suggested_mappings']['symbol'] == 'Ticker'
        assert preview['suggested_mappings']['side'] == 'Action'
        assert preview['suggested_mappings']['quantity'] == 'Shares'
        assert preview['suggested_mappings']['price'] == 'Fill Price'
        assert preview['suggested_mappings']['trade_date'] == 'Trade Date'
        assert preview['suggested_mappings']['commission'] == 'Commission'
        print("PASS: preview endpoint")


def test_crud_endpoints():
    with app.app_context():
        db.create_all()

        client = app.test_client()

        # Create
        create_resp = client.post(
            '/api/broker-import-mappings',
            json={
                'name': 'Test Mapping',
                'column_mappings': {
                    'symbol': 'Ticker',
                    'side': 'Action',
                    'quantity': 'Shares',
                    'price': 'Fill Price',
                    'trade_date': 'Trade Date',
                    'commission': 'Commission',
                },
                'parser_config': {'header_row_index': 0},
            }
        )
        assert create_resp.status_code == 200, create_resp.data
        mapping = create_resp.get_json()['data']
        assert mapping['name'] == 'Test Mapping'
        assert 'account_id' not in mapping

        # List
        list_resp = client.get('/api/broker-import-mappings')
        assert list_resp.status_code == 200
        assert len(list_resp.get_json()['data']) == 1

        # Update
        update_resp = client.put(
            f'/api/broker-import-mappings/{mapping["id"]}',
            json={'name': 'Updated Mapping'}
        )
        assert update_resp.status_code == 200
        assert update_resp.get_json()['data']['name'] == 'Updated Mapping'

        # Delete
        delete_resp = client.delete(f'/api/broker-import-mappings/{mapping["id"]}')
        assert delete_resp.status_code == 200

        list_resp = client.get('/api/broker-import-mappings')
        assert len(list_resp.get_json()['data']) == 0
        print("PASS: CRUD endpoints")


def test_import_with_mapping_via_account():
    with app.app_context():
        db.create_all()
        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()

        client = app.test_client()

        # Create global mapping
        create_resp = client.post(
            '/api/broker-import-mappings',
            json={
                'name': 'Test Mapping',
                'column_mappings': {
                    'symbol': 'Ticker',
                    'side': 'Action',
                    'quantity': 'Shares',
                    'price': 'Fill Price',
                    'trade_date': 'Trade Date',
                    'commission': 'Commission',
                },
                'parser_config': {'header_row_index': 0},
            }
        )
        mapping_id = create_resp.get_json()['data']['id']

        # Assign mapping to account
        update_account_resp = client.put(
            f'/api/accounts/{account.id}',
            json={'broker_import_mapping_id': mapping_id}
        )
        assert update_account_resp.status_code == 200

        # Validate (no explicit format/mapping; should use account's mapping)
        validate_resp = client.post(
            '/api/import/validate',
            data={
                'file': (io.BytesIO(_csv_content()), 'trades.csv'),
                'account_id': account.id,
            },
            content_type='multipart/form-data'
        )
        assert validate_resp.status_code == 200, validate_resp.data
        validation = validate_resp.get_json()
        assert validation['success'] is True
        assert validation['data']['expected_executions'] == 2

        # Import
        import_resp = client.post(
            '/api/import/csv',
            data={
                'file': (io.BytesIO(_csv_content()), 'trades.csv'),
                'account_id': account.id,
            },
            content_type='multipart/form-data'
        )
        assert import_resp.status_code == 200, import_resp.data
        result = import_resp.get_json()
        assert result['success'] is True
        assert result['executions_added'] == 2
        print("PASS: import with mapping via account")


def _csv_content_no_side():
    return (
        "Symbol,Qty,Price,Date\n"
        "AAPL,10,150.00,2026-01-15\n"
        "TSLA,-5,200.00,2026-01-16\n"
    ).encode('utf-8')


def test_import_with_formula_value_mappings():
    with app.app_context():
        db.create_all()
        account = Account(name='Test Account')
        db.session.add(account)
        db.session.commit()

        client = app.test_client()

        # Create global mapping where quantity column is reused for side
        # and value formulas map >0 to BUY and <0 to SELL
        create_resp = client.post(
            '/api/broker-import-mappings',
            json={
                'name': 'Quantity to Side Mapping',
                'column_mappings': {
                    'symbol': 'Symbol',
                    'quantity': 'Qty',
                    'side': 'Qty',
                    'price': 'Price',
                    'trade_date': 'Date',
                },
                'value_mappings': {
                    'side': {
                        '>0': 'BUY',
                        '<0': 'SELL',
                    },
                },
                'parser_config': {
                    'header_row_index': 0,
                },
            }
        )
        mapping_id = create_resp.get_json()['data']['id']

        # Assign mapping to account
        update_account_resp = client.put(
            f'/api/accounts/{account.id}',
            json={'broker_import_mapping_id': mapping_id}
        )
        assert update_account_resp.status_code == 200

        # Import
        import_resp = client.post(
            '/api/import/csv',
            data={
                'file': (io.BytesIO(_csv_content_no_side()), 'trades.csv'),
                'account_id': account.id,
            },
            content_type='multipart/form-data'
        )
        assert import_resp.status_code == 200, import_resp.data
        result = import_resp.get_json()
        assert result['success'] is True
        assert result['executions_added'] == 2

        # Verify sides and normalized quantities
        from models import Execution
        executions = Execution.query.filter_by(account_id=account.id).order_by(Execution.id).all()
        assert len(executions) == 2
        assert executions[0].side == 'BUY'
        assert float(executions[0].quantity) == 10
        assert executions[1].side == 'SELL'
        assert float(executions[1].quantity) == -5
        print("PASS: import with formula value mappings")


def _tradier_csv_content():
    return (
        '"Symbol","Price","Type","Description","Quantity","Commission","Amount","Date"\n'
        '"MU260702C01410000",0,"option","MU260702C01410000",-1,0,0,"2026-07-02T00:00:00Z"\n'
        '"MU260702C01185000",0,"option","MU260702C01185000",1,0,0,"2026-07-02T00:00:00Z"\n'
        '"MU260702P00945000",2.12,"trade","MU Jul 2, 2026 $945.00 Put",-1,0,211.87,"2026-07-01T00:00:00Z"\n'
        '"SPY",150.00,"trade","SPY trade",10,1.00,1499.00,"2026-07-01T00:00:00Z"\n'
        ',0,"wire","Wire Funds Received",0,0,30000,"2026-06-29T00:00:00Z"\n'
    ).encode('utf-8')


def test_tradier_style_import():
    with app.app_context():
        db.create_all()
        account = Account(name='Tradier Test Account')
        db.session.add(account)
        db.session.commit()

        client = app.test_client()

        # Create a Tradier-style mapping
        create_resp = client.post(
            '/api/broker-import-mappings',
            json={
                'name': 'Tradier Mapping',
                'column_mappings': {
                    'symbol': 'Symbol',
                    'price': 'Price',
                    'quantity': 'Quantity',
                    'side': 'Quantity',
                    'commission': 'Commission',
                    'amount': 'Amount',
                    'net_cash': 'Amount',
                    'trade_date': 'Date',
                    'exec_datetime': 'Date',
                    'description': 'Description',
                },
                'value_mappings': {
                    'side': {
                        '>0': 'BUY',
                        '<0': 'SELL',
                    },
                },
                'parser_config': {
                    'header_row_index': 0,
                    'asset_class_from_symbol': True,
                    'parse_option_details_from_symbol': True,
                    'type_filter': {
                        'column': 'Type',
                        'include': ['option', 'trade'],
                    },
                },
            }
        )
        assert create_resp.status_code == 200, create_resp.data
        mapping_id = create_resp.get_json()['data']['id']

        # Validate: should exclude the wire row
        validate_resp = client.post(
            '/api/import/validate',
            data={
                'file': (io.BytesIO(_tradier_csv_content()), 'tradier.csv'),
                'account_id': account.id,
                'broker_import_mapping_id': mapping_id,
            },
            content_type='multipart/form-data'
        )
        assert validate_resp.status_code == 200, validate_resp.data
        validation = validate_resp.get_json()
        assert validation['success'] is True
        rows = validation['data']['rows']
        # 5 total rows: 4 trade/option rows + 1 wire row
        assert len(rows) == 5
        included = [r for r in rows if r['include']]
        excluded = [r for r in rows if not r['include']]
        assert len(included) == 4
        assert len(excluded) == 1
        assert excluded[0]['reason'] == 'Non-trade type: wire'

        # Excluded wire row should not show 'nan', 'null', or 'None' in preview cells
        for val in excluded[0]['data'].values():
            assert str(val).strip().lower() not in ('nan', 'none', 'null')

        # Verify preview row_data shows derived/transformed values
        first = included[0]['data']
        assert first['Symbol'] == 'MU 2026-07-02 1410 C'
        assert first['Buy/Sell'] == 'SELL'
        assert first['AssetClass'] == 'OPT'
        assert first['UnderlyingSymbol'] == 'MU'
        assert first['Put/Call'] == 'C'
        assert first['Expiry'] == '2026-07-02'
        assert float(first['Strike']) == 1410.0
        assert first['Description'] == 'MU 2026-07-02 1410.00 Call'
        assert first['Date/Time'].startswith('2026-07-02')
        assert float(first['NetCash']) == 0.0

        # Stock row
        stock_row = included[3]['data']
        assert stock_row['Symbol'] == 'SPY'
        assert stock_row['Buy/Sell'] == 'BUY'
        assert stock_row['AssetClass'] == 'STK'
        assert float(stock_row['NetCash']) == 1499.0
        assert float(stock_row['Price']) == 150.0
        assert float(stock_row['Quantity']) == 10

        # Import
        import_resp = client.post(
            '/api/import/csv',
            data={
                'file': (io.BytesIO(_tradier_csv_content()), 'tradier.csv'),
                'account_id': account.id,
                'broker_import_mapping_id': mapping_id,
                'selected_row_indices': json.dumps([r['index'] for r in included]),
            },
            content_type='multipart/form-data'
        )
        assert import_resp.status_code == 200, import_resp.data
        result = import_resp.get_json()
        assert result['success'] is True
        assert result['executions_added'] == 4

        # Verify execution details
        from models import Execution
        executions = Execution.query.filter_by(account_id=account.id).order_by(Execution.id).all()
        assert len(executions) == 4

        # Row 0: MU call, qty -1 -> SELL, asset_class OPT
        assert executions[0].side == 'SELL'
        assert float(executions[0].quantity) == -1
        assert executions[0].asset_class == 'OPT'
        assert executions[0].underlying_symbol == 'MU'
        assert executions[0].put_call == 'C'
        assert executions[0].expiry.isoformat() == '2026-07-02'

        # Row 1: MU call, qty 1 -> BUY
        assert executions[1].side == 'BUY'
        assert float(executions[1].quantity) == 1
        assert executions[1].asset_class == 'OPT'

        # Row 2: MU put, qty -1 -> SELL
        assert executions[2].side == 'SELL'
        assert executions[2].put_call == 'P'
        assert executions[2].asset_class == 'OPT'

        # Row 3: SPY stock, qty 10 -> BUY, asset_class STK
        assert executions[3].side == 'BUY'
        assert float(executions[3].quantity) == 10
        assert executions[3].asset_class == 'STK'
        assert executions[3].multiplier == 1

        print("PASS: tradier-style import")


if __name__ == '__main__':
    test_preview_endpoint()
    test_crud_endpoints()
    test_import_with_mapping_via_account()
    test_import_with_formula_value_mappings()
    test_tradier_style_import()
    print("\nAll broker import mapping tests passed!")
