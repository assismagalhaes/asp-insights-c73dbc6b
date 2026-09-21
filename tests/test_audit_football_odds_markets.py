from scripts.audit_football_odds_markets import summarize_payloads


def market(name, bookmaker="bet365", values=None):
    return {
        "market": name,
        "bookmakerName": bookmaker,
        "type": "prematch",
        "values": values or [{"value": "Home", "odd": 2.0}],
    }


def test_report_separates_provider_presence_from_canonical_eligibility():
    payload = {
        "data": [
            {
                "matchId": 42,
                "odds": [
                    market("Full Time Result"),
                    market("Total Goals 2.5"),
                    market("Both Teams To Score"),
                    market("Asian Handicap -0.5/+0.5"),
                    market("Double Chance", bookmaker="unsupported book"),
                ],
            }
        ]
    }

    report = summarize_payloads([payload])

    assert report["provider_calls"] == 0
    assert report["published"] is False
    assert report["target_presence"]["moneyline"]["status"] == "present"
    assert report["target_presence"]["total"]["status"] == "present"
    assert report["target_presence"]["both_teams_to_score"]["status"] == "present"
    assert report["target_presence"]["handicap"]["status"] == "present"
    assert report["target_presence"]["double_chance"] == {
        "raw_market_blocks": 1,
        "eligible_market_blocks": 0,
        "status": "not_observed",
    }
    assert dict(report["rejection_reasons"])["bookmaker_missing"] == 1
