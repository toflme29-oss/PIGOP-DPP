import sqlite3
import os

db_path = 'pigop_dev.db'
if not os.path.exists(db_path):
    print(f"Error: {db_path} no existe.")
else:
    conn = sqlite3.connect(db_path)
    res = conn.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
    print("Tablas en la DB:")
    for row in res:
        print(f"- {row[0]}")
    conn.close()
