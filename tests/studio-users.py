import http.client
import json

BASE = "127.0.0.1:8765"


def request(method, path, body=None, cookie=None, expected=200):
    connection = http.client.HTTPConnection(BASE, timeout=10)
    headers = {"Origin": "http://127.0.0.1:8765", "Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    connection.request(method, path, json.dumps(body) if body is not None else None, headers)
    response = connection.getresponse()
    data = json.loads(response.read().decode("utf-8"))
    session = response.getheader("Set-Cookie")
    connection.close()
    assert response.status == expected, (method, path, expected, response.status, data)
    return data, session.split(";", 1)[0] if session else None


admin, admin_cookie = request(
    "POST", "/api/studio/login", {"operatorName": "Floris", "password": "AdminSecret123"}
)
assert admin["role"] == "admin" and admin_cookie

created, _ = request(
    "POST", "/api/studio/users",
    {"displayName": "Sofia", "email": "sofia@example.org", "password": "FirstPass123"},
    admin_cookie, 201,
)
user_id = created["user"]["id"]
assert created["user"]["active"] is True

staff, staff_cookie = request(
    "POST", "/api/studio/login", {"email": "sofia@example.org", "password": "FirstPass123"}
)
assert staff["role"] == "staff" and staff["operatorName"] == "Sofia"
request("GET", "/api/studio/users", cookie=staff_cookie, expected=403)
request("POST", "/api/studio/recovery-email", {"email": "bad@example.org"}, staff_cookie, 403)
messages, _ = request("GET", "/api/studio/messages?status=active&limit=1", cookie=staff_cookie)
assert messages["role"] == "staff" and messages["operatorName"] == "Sofia"

_, new_staff_cookie = request(
    "POST", "/api/studio/password",
    {"currentPassword": "FirstPass123", "newPassword": "SecondPass123", "confirmation": "SecondPass123"},
    staff_cookie,
)
assert new_staff_cookie
request("GET", "/api/studio/messages", cookie=staff_cookie, expected=401)
request("GET", "/api/studio/messages", cookie=new_staff_cookie)

# A changed shared admin password must not close the individual account.
_, new_admin_cookie = request(
    "POST", "/api/studio/password",
    {"currentPassword": "AdminSecret123", "newPassword": "AdminSecret456", "confirmation": "AdminSecret456"},
    admin_cookie,
)
assert new_admin_cookie
request("GET", "/api/studio/messages", cookie=admin_cookie, expected=401)
request("GET", "/api/studio/messages", cookie=new_staff_cookie)

request("PATCH", f"/api/studio/users/{user_id}", {"active": False}, new_admin_cookie)
request("GET", "/api/studio/messages", cookie=new_staff_cookie, expected=401)
request("POST", "/api/studio/login", {"email": "sofia@example.org", "password": "SecondPass123"}, expected=401)
request("PATCH", f"/api/studio/users/{user_id}", {"active": True}, new_admin_cookie)
request("PATCH", f"/api/studio/users/{user_id}", {"password": "NewerPass123"}, new_admin_cookie)
request("POST", "/api/studio/login", {"email": "sofia@example.org", "password": "SecondPass123"}, expected=401)
staff, _ = request("POST", "/api/studio/login", {"email": "sofia@example.org", "password": "NewerPass123"})
assert staff["role"] == "staff"
print("Studio accounts: creation, role checks, password rotation, disable and reset OK")
