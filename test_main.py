# test_main.py
from fastapi.testclient import TestClient
from main import app

# The TestClient acts as a fake web browser that talks directly to your FastAPI app
client = TestClient(app)


def test_full_crud_workflow():
    """
    Testing the sequence:
    Read Initial -> Create -> Read Verification -> Update -> Delete -> Read Final
    """

    # 1. Get all skins and assert length is 5
    response = client.get("/skins")
    assert response.status_code == 200
    skins = response.json()
    assert len(skins) == 5

    # 2. Create a skin
    new_skin_data = {
        "name": "Desert Eagle | Printstream",
        "float_value": 0.0420,
        "price": 95.00
    }
    response = client.post("/skins", json=new_skin_data)
    assert response.status_code == 201
    created_skin = response.json()
    assert created_skin["name"] == new_skin_data["name"]

    # Save the generated ID for the next steps
    skin_id = created_skin["id"]

    # 3. Get all skins and assert new length is 6
    response = client.get("/skins")
    skins = response.json()
    assert len(skins) == 6
    # Check if the last skin matches our newly created one
    assert skins[-1]["id"] == skin_id

    # 4. Modify the skin
    updated_data = {
        "name": "Desert Eagle | Printstream",
        "float_value": 0.0420,
        "price": 105.00  # Price went up!
    }
    response = client.put(f"/skins/{skin_id}", json=updated_data)
    assert response.status_code == 200
    assert response.json()["price"] == 105.00

    # 5. Delete the skin
    response = client.delete(f"/skins/{skin_id}")
    assert response.status_code == 204  # 204 means successful deletion with no content returned

    # 6. Get all skins and assert new length is back to 5
    response = client.get("/skins")
    skins = response.json()
    assert len(skins) == 5


# --- EDGE CASE TESTS (For maximum coverage) ---

def test_update_nonexistent_skin():
    # Try to update a skin that doesn't exist
    response = client.put("/skins/9999", json={"name": "Fake", "float_value": 0.1, "price": 10.0})
    assert response.status_code == 404


def test_delete_nonexistent_skin():
    # Try to delete a skin that doesn't exist
    response = client.delete("/skins/9999")
    assert response.status_code == 404


def test_data_validation_failure():
    # Try to create a skin with a negative price (Pydantic should block this)
    bad_data = {
        "name": "Bad Skin",
        "float_value": 0.1,
        "price": -50.0
    }
    response = client.post("/skins", json=bad_data)
    assert response.status_code == 422  # 422 Unprocessable Entity

def test_statistics_api():
    response = client.get("/users/15/inventory/total_value")
    assert response.json() == 5594.22

    response = client.get("/users/15/inventory/asset_allocation")
    data = response.json()
    assert len(data) == 5
    assert data["skin"] == 54.349999999999994
    assert data["case"] == 39.87
    assert data["agent"] == 0
    assert data["charm"] == 0
    assert data["sticker"] == 5500

    response = client.get("/users/15/inventory/rarity_distribution")
    data = response.json()
    assert len(data) == 7
    assert data["consumer_grade"] == 1
    assert data["industrial_grade"] == 0
    assert data["mil_spec_grade"] == 0
    assert data["restricted"] == 0
    assert data["classified"] == 0
    assert data["covert"] == 1
    assert data["extraordinary"] == 0

