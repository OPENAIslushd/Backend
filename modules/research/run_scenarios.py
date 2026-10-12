"""Reproduce normalization tests from saved evidence, without network access."""
import json
from pathlib import Path
from research_profile import plausible_profile, marketplace_profile, idea_profile, validate

ROOT = Path(__file__).resolve().parent


def main():
    source = json.loads((ROOT/'fixtures/plausible.source.json').read_text())
    results = {
        'plausible': plausible_profile((ROOT/'fixtures/plausible.html').read_text(), source),
        'trendyol': marketplace_profile(json.loads((ROOT/'fixtures/trendyol.observations.json').read_text())),
        'idea': idea_profile(json.loads((ROOT/'fixtures/idea.input.json').read_text()))
    }
    folder = ROOT/'outputs'
    folder.mkdir(exist_ok=True)
    summary = []
    for name, profile in results.items():
        validate(profile)
        (folder/f'{name}.profile.json').write_text(json.dumps(profile, ensure_ascii=False, indent=2)+'\n')
        summary.append(dict(scenario=name, validation='passed', extraction_status=profile['status'],
                            own_products=len(profile['products']), market_products=len(profile['market_products']),
                            research=profile['research_status'], simulation=profile['simulation_status']))
    (folder/'scenario-results.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
