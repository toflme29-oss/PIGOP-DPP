import requests
import sys

URL_BASE = "http://localhost:8000/api/v1"

def test_visto_bueno():
    # 1. Login
    login_data = {
        "email": "subcep@pigop.gob.mx",
        "password": "Password123!" # suponiendo contraseña default
    }
    print("Tentando login...")
    r = requests.post(f"{URL_BASE}/auth/login", json=login_data)
    if r.status_code != 200:
        print(f"Login fallback failed: {r.status_code} {r.text}")
        return
    
    token = r.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Get documents
    r_docs = requests.get(f"{URL_BASE}/documentos/", headers=headers, params={"estado": "respondido"})
    if r_docs.status_code != 200:
        print(f"Docs failed: {r_docs.status_code} {r_docs.text}")
        return
        
    docs = r_docs.json()
    if not docs:
        print("No documents found with estado respondido")
        return
        
    doc_id = docs[0]['id']
    print(f"Testing with doc: {doc_id}")
    
    # 3. Post Visto Bueno
    r_vobo = requests.post(f"{URL_BASE}/documentos/{doc_id}/visto-bueno", headers=headers)
    print(f"Result {r_vobo.status_code}: {r_vobo.text}")

if __name__ == "__main__":
    test_visto_bueno()
