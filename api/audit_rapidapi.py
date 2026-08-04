import os
import sys
import time
from typing import Any

# Add api/ to path so we can import highlightly_client
sys.path.append(os.path.join(os.getcwd(), "api"))

from highlightly_client import HighlightlyClient, HighlightlyError

def test_sport(client: HighlightlyClient, sport: str, date: str):
    print(f"\n--- Testing {sport.upper()} ---")
    start = time.perf_counter()
    try:
        # According to highlightly/openapi.json, endpoints are like /football/matches
        path = f"/{sport.lower()}/matches"
        response = client.get(path, params={"date": date, "limit": 1})
        latency = (time.perf_counter() - start) * 1000
        
        data = response.data or {}
        # Adjust based on expected Highlightly response structure
        # Usually data is a list or contains a list
        if isinstance(data, list):
            count = len(data)
        elif isinstance(data, dict):
            # Check for common keys like 'data', 'matches', 'results'
            items = data.get("data") or data.get("matches") or data.get("results") or []
            count = len(items) if isinstance(items, list) else 1
        else:
            count = 1
            
        print(f"Status: {response.status}")
        print(f"Latency: {latency:.2f}ms")
        print(f"Quota Remaining: {response.rate_remaining}/{response.rate_limit}")
        print(f"Records Found: {count}")
        return True
    except HighlightlyError as e:
        latency = (time.perf_counter() - start) * 1000
        print(f"Status: {e.status}")
        print(f"Latency: {latency:.2f}ms")
        print(f"Error: {e}")
        if e.body:
            print(f"Response Body: {e.body}")
        return False
    except Exception as e:
        print(f"Unexpected Error: {e}")
        return False

def main():
    # Use dummy key if not set, but the request will likely 401/403
    api_key = os.getenv("HIGHLIGHTLY_API_KEY", "dummy-key-for-audit")
    base_url = os.getenv("HIGHLIGHTLY_BASE_URL", "https://sports.highlightly.net")
    
    print(f"Auditing Host: {base_url}")
    print("Authentication: x-rapidapi-key (direct Highlightly host)")
    
    client = HighlightlyClient(api_key, base_url=base_url)
    
    # Test Football
    success = test_sport(client, "football", "2026-08-01")
    
    # If football succeeds (HTTP 200), test Basketball and Baseball
    if success:
        test_sport(client, "basketball", "2026-08-01")
        test_sport(client, "baseball", "2026-08-01")
    else:
        print("\nFootball test did not return HTTP 200. Skipping Basketball and Baseball tests.")

if __name__ == "__main__":
    main()
