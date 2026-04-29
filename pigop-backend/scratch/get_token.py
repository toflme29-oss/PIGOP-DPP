import asyncio
import os
import sys

sys.path.append(os.getcwd())
from app.core.security import create_access_token

def get_token():
    # User ID for subcep@pigop.gob.mx (Eduardo Cortés Jaramillo)
    # Buscamos en check_users_ids.py -> ID: b4af9d5a-2fb5-49ed-9421-9d4ce0df49ac
    user_id = "b4af9d5a-2fb5-49ed-9421-9d4ce0df49ac"
    return create_access_token(user_id)

if __name__ == "__main__":
    t = get_token()
    print(t)
