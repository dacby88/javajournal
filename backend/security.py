import secrets

from flask import jsonify, request, session

from auth import require_auth

PUBLIC_ENDPOINTS = {'health_check', 'readiness_check', 'auth.status', 'auth.csrf',
                    'auth.login', 'auth.setup'}


def install_security(app):
    @app.before_request
    def protect_api():
        if not request.path.startswith('/api/'):
            return None
        if request.method == 'OPTIONS':
            return None
        if request.endpoint not in PUBLIC_ENDPOINTS:
            authenticated, response = require_auth()
            if not authenticated:
                return response
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            expected = session.get('csrf_token')
            supplied = request.headers.get('X-CSRF-Token', '')
            if not expected or not secrets.compare_digest(expected.encode(), supplied.encode()):
                return jsonify(success=False, error='Invalid CSRF token. Refresh and try again.'), 403
        return None

    @app.after_request
    def safe_responses(response):
        if request.path.startswith('/api/'):
            if response.status_code >= 500:
                app.logger.error('API operation failed: %s %s', request.method, request.endpoint)
                response = jsonify(success=False, error='The request could not be completed. Check server availability and configuration.')
                response.status_code = 503 if request.endpoint == 'readiness_check' else 500
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
