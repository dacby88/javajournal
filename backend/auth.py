"""
Authentication module for the trading journal application.
Provides routes for user setup, login, logout, and session management.
Uses Flask's built-in signed cookie sessions.
"""

from flask import Blueprint, request, jsonify, session, current_app
from datetime import datetime, timedelta
import bcrypt
import re
import hashlib
import secrets
from sqlalchemy.exc import IntegrityError

from models import db, User

# Create blueprint
auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

# Session lifetime in days
SESSION_LIFETIME_DAYS = 7


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    password_bytes = hashlib.sha256(password.encode('utf-8')).hexdigest().encode('ascii')
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against its hash."""
    password_bytes = hashlib.sha256(password.encode('utf-8')).hexdigest().encode('ascii')
    hash_bytes = password_hash.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hash_bytes)


def validate_username(username: str) -> tuple[bool, str]:
    """Validate username format."""
    if not username:
        return False, "Username is required"
    if len(username) < 3:
        return False, "Username must be at least 3 characters long"
    if len(username) > 50:
        return False, "Username must be at most 50 characters long"
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return False, "Username can only contain letters, numbers, and underscores"
    return True, ""


def validate_password(password: str) -> tuple[bool, str]:
    """Validate password strength."""
    if not password:
        return False, "Password is required"
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if len(password) > 128:
        return False, "Password must be at most 128 characters long"
    return True, ""


def validate_email(email: str) -> tuple[bool, str]:
    """Validate email format."""
    if not email:
        return True, ""  # Email is optional
    if len(email) > 100:
        return False, "Email must be at most 100 characters long"
    # Basic email regex pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(pattern, email):
        return False, "Invalid email format"
    return True, ""


@auth_bp.route('/csrf', methods=['GET'])
def csrf():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_urlsafe(32)
    return jsonify(csrf_token=session['csrf_token'])


@auth_bp.route('/setup', methods=['POST'])
def setup():
    """
    One-time registration endpoint.
    Only works if no user exists in the database.
    """
    try:
        if not secrets.compare_digest(request.headers.get('X-Setup-Token', '').encode(), current_app.config['SETUP_TOKEN'].encode()):
            return jsonify(success=False, error='A valid setup token from the operator is required.'), 403
        # Check if a user already exists
        existing_user = User.query.first()
        if existing_user:
            return jsonify({
                'success': False,
                'error': 'Setup has already been completed. Use /api/auth/login instead.'
            }), 403
        
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': 'Request body is required'
            }), 400
        
        username = data.get('username', '').strip()
        password = data.get('password', '')
        email = data.get('email', '').strip() if data.get('email') else None
        
        # Validate inputs
        valid, error = validate_username(username)
        if not valid:
            return jsonify({'success': False, 'error': error}), 400
        
        valid, error = validate_password(password)
        if not valid:
            return jsonify({'success': False, 'error': error}), 400
        
        valid, error = validate_email(email)
        if not valid:
            return jsonify({'success': False, 'error': error}), 400
        
        # Create the user
        user = User(
            id=1,
            username=username,
            password_hash=hash_password(password),
            email=email
        )
        db.session.add(user)
        db.session.commit()
        
        # Store user_id in Flask session
        session.clear()
        session['user_id'] = user.id
        session.permanent = True
        
        return jsonify({
            'success': True,
            'message': 'User created successfully',
            'user': user.to_dict()
        }), 201
        
    except IntegrityError:
        db.session.rollback()
        return jsonify(success=False, error='Setup has already been completed.'), 409
    except Exception:
        db.session.rollback()
        return jsonify(success=False, error='Could not complete setup.'), 500


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Login with username and password.
    """
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': 'Request body is required'
            }), 400
        
        username = data.get('username', '').strip()
        password = data.get('password', '')
        
        if not username or not password:
            return jsonify({
                'success': False,
                'error': 'Username and password are required'
            }), 400
        
        # Find the user
        user = User.query.filter_by(username=username).first()
        if not user or not user.is_active:
            return jsonify({
                'success': False,
                'error': 'Invalid username or password'
            }), 401
        
        # Verify password
        if not verify_password(password, user.password_hash):
            return jsonify({
                'success': False,
                'error': 'Invalid username or password'
            }), 401
        
        # Store user_id in Flask session
        session.clear()
        session['user_id'] = user.id
        session.permanent = True
        
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'user': user.to_dict()
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': f'Login failed: {str(e)}'
        }), 500


@auth_bp.route('/logout', methods=['POST'])
def logout():
    """
    Logout the current user.
    """
    try:
        # Clear the session
        session.clear()
        
        return jsonify({
            'success': True,
            'message': 'Logout successful'
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Logout failed: {str(e)}'
        }), 500


@auth_bp.route('/status', methods=['GET'])
def status():
    """
    Check authentication status.
    Returns whether setup is needed and whether user is authenticated.
    """
    try:
        # Check if any user exists
        user_exists = User.query.first() is not None
        
        # Check if user is logged in via session
        user_id = session.get('user_id')
        authenticated = False
        user = None
        
        if user_id:
            user = User.query.get(user_id)
            if user and user.is_active:
                authenticated = True
        
        return jsonify({
            'success': True,
            'needs_setup': not user_exists,
            'authenticated': authenticated,
            'user': user.to_dict() if authenticated else None
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to check status: {str(e)}'
        }), 500


@auth_bp.route('/change-password', methods=['POST'])
def change_password():
    """
    Change password for the currently logged in user.
    Requires current password verification.
    """
    try:
        # Check if user is authenticated
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({
                'success': False,
                'error': 'Authentication required'
            }), 401
        
        user = User.query.get(user_id)
        if not user:
            session.clear()
            return jsonify({
                'success': False,
                'error': 'User not found. Please login again.'
            }), 401
        
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'error': 'Request body is required'
            }), 400
        
        current_password = data.get('current_password', '')
        new_password = data.get('new_password', '')
        
        if not current_password or not new_password:
            return jsonify({
                'success': False,
                'error': 'Current password and new password are required'
            }), 400
        
        # Verify current password
        if not verify_password(current_password, user.password_hash):
            return jsonify({
                'success': False,
                'error': 'Current password is incorrect'
            }), 401
        
        # Validate new password
        valid, error = validate_password(new_password)
        if not valid:
            return jsonify({'success': False, 'error': error}), 400
        
        # Update password
        user.password_hash = hash_password(new_password)
        user.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Password changed successfully'
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': f'Failed to change password: {str(e)}'
        }), 500


# ==================== Authentication Helpers ====================

def get_current_user():
    """
    Get the currently authenticated user.
    Returns the User object or None if not authenticated.
    """
    user_id = session.get('user_id')
    if not user_id:
        return None
    
    return User.query.get(user_id)


def require_auth():
    """
    Check if the current request is authenticated.
    Returns a tuple (is_authenticated, response_or_none).
    If not authenticated, returns (False, error_response).
    If authenticated, returns (True, None).
    """
    user_id = session.get('user_id')
    if not user_id:
        return False, (jsonify({
            'success': False,
            'error': 'Authentication required. Please login.'
        }), 401)
    
    user = User.query.get(user_id)
    if not user or not user.is_active:
        session.clear()
        return False, (jsonify({
            'success': False,
            'error': 'Invalid session. Please login again.'
        }), 401)
    
    return True, None


def is_auth_route(path: str) -> bool:
    """
    Check if the given path is an authentication route that should be exempt
    from authentication middleware.
    """
    auth_paths = [
        '/api/auth/',
        '/api/health',
    ]
    return any(path.startswith(p) for p in auth_paths)
