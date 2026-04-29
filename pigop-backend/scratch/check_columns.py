import sqlite3
import os

db_path = 'pigop_dev.db'
if not os.path.exists(db_path):
    print(f"Error: {db_path} no existe.")
else:
    conn = sqlite3.connect(db_path)
    res = conn.execute("PRAGMA table_info(documentos_oficiales);").fetchall()
    print("Columnas en documentos_oficiales:")
    for row in res:
        print(f"- {row[1]}")
    conn.close()
