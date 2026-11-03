# run using python -m scripts.init_db

from app import app, db
with app.app_context():
    db.drop_all()
    db.create_all()
    print("Database tables dropped and recreated successfully.")