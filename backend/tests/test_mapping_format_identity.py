import io
import json

from app import app
from models import db, Account, BrokerImportMapping, ImportHistory


def test_custom_mapping_does_not_reference_a_broker_format_with_the_same_id():
    with app.app_context():
        mapping = BrokerImportMapping(id=1000, name='Synthetic mapping', column_mappings=json.dumps({
            'symbol': 'Symbol', 'side': 'Side', 'quantity': 'Quantity', 'price': 'Price', 'trade_date': 'Date',
        }))
        db.session.add(mapping)
        db.session.flush()
        account = Account(name='Synthetic mapping account', broker_import_mapping_id=mapping.id)
        db.session.add(account)
        db.session.commit()
        response = app.test_client().post('/api/import/csv', data={
            'account_id': str(account.id),
            'file': (io.BytesIO(b'Symbol,Side,Quantity,Price,Date\nAAPL,BUY,1,100,2026-01-15\n'), 'synthetic.csv'),
        })
        assert response.status_code == 200
        assert response.get_json()['success']
        assert ImportHistory.query.one().broker_format_id is None
