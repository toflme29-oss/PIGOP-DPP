import requests

token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiNGFmOWQ1YS0yZmI1LTQ5ZWQtOTQyMS05ZDRjZTBkZjQ5YWMiLCJleHAiOjE3NzY5MTU4MjQsImlhdCI6MTc3NjkxNDAyNCwidGlwbyI6ImFjY2VzcyJ9.s8lH_rDYhkUzRKrQ21kLOFw-I4R-HkW6tabbBoLWR4M"
URL_BASE = "http://localhost:8000/api/v1"

def test_vobo():
    headers = {"Authorization": f"Bearer {token}"}
    
    r_docs = requests.get(f"{URL_BASE}/documentos/", headers=headers, params={"estado": "respondido"})
    docs = r_docs.json()
    if not docs:
        print("No documents found with estado respondido")
        return
        
    doc_id = docs[0]['id']
    print(f"Testing with doc: {doc_id}")
    
    r_vobo = requests.post(f"{URL_BASE}/documentos/{doc_id}/visto-bueno", headers=headers)
    print(f"Result {r_vobo.status_code}: {r_vobo.text}")

if __name__ == "__main__":
    test_vobo()
