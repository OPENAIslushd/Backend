"""Orchestrator bridge: JSON company profile on stdin, research handoff JSON on stdout.

The Orchestrator runs this as a subprocess. The user's campaign form submission is the
profile confirmation; no live web search runs (catalog matching only).
"""
import json
import sys
from app import dispatch


def run(data):
    session = {}
    profile = dispatch(session, 'profile', {
        'mode': 'company',
        'name': data.get('name', ''),
        'url': data.get('url') or '',
        'description': data.get('description', ''),
        'topic': data.get('topic') or '',
        'market': data.get('market') or '',
        'goal': data.get('goal') or 'Rakip ürün bilgilerini karşılaştırmak',
        'audience': data.get('audience') or '',
    })
    dispatch(session, 'confirm', {'revision': profile['revision']})
    found = dispatch(session, 'research', {})
    ids = [card['id'] for card in found['cards']]
    handoff = dispatch(session, 'handoff', {'ids': ids}) if ids else None
    return {
        'collection_method': found['collection_method'],
        'catalog_categories': found.get('catalog_categories', []),
        'competitors': handoff['comparison']['selected_competitors'] if handoff else [],
        'warnings': handoff['comparison'].get('warnings', []) if handoff else [],
    }


if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin))
    except Exception as error:  # Reported to the Orchestrator as a failed step.
        json.dump({'error': str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
    json.dump(result, sys.stdout, ensure_ascii=False)
