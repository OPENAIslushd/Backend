"""Offline HTML evidence extraction. Does not execute scripts or fetch URLs."""
import argparse
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.capture = None
        self.parts = []
        self.blocks = []
        self.title = ""
        self.description = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style", "noscript", "template"}:
            self.hidden += 1
        if self.hidden:
            return
        if tag == "meta" and attrs.get("name") == "description":
            self.description = attrs.get("content")
        if tag in {"title", "h1", "h2", "h3", "p", "li"}:
            if self.capture:
                self.flush()
            self.capture = tag
            self.parts = []

    def handle_data(self, data):
        if not self.hidden and self.capture:
            self.parts.append(data)

    def flush(self):
        value = " ".join(" ".join(self.parts).split())
        if value:
            if self.capture == "title":
                self.title = value
            else:
                self.blocks.append({"tag": self.capture, "text": value})
        self.capture = None
        self.parts = []

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "template"}:
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag == self.capture:
            self.flush()


def extract_evidence(html, source_url, accessed_at):
    if urlparse(source_url).scheme not in {"http", "https"}:
        raise ValueError("Kaynak adresi HTTP veya HTTPS olmalı.")
    parser = PageParser()
    parser.feed(html)
    parser.close()
    parser.flush()
    # These are candidates, not verified product features or normalized prices.
    pricing = []
    for i, block in enumerate(parser.blocks):
        if re.search(r"[$€£₺]\s*\d|\d[\d.,\s]*\s*(?:TL|TRY|USD|EUR|₺|€|\$)(?!\w)|\b(pricing|contact sales|fiyat|fiyatlandırma)\b", block["text"], re.I):
            pricing.append({"text": block["text"], "context": parser.blocks[max(0, i-1):i+2], "source_ids": ["s1"]})
    return {
        "schema_version": "1.0",
        "is_demo": False,
        "stage": "site_evidence",
        "review_status": "needs_review",
        "status": "partial",
        "page_title": parser.title,
        "description_candidate": parser.description,
        "section_candidates": [dict(b, source_ids=["s1"]) for b in parser.blocks if b["tag"] in {"h1", "h2", "h3"}],
        "pricing_candidates": pricing,
        "content_blocks": parser.blocks,
        "sources": [{"id": "s1", "type": "website", "url": source_url, "title": parser.title, "accessed_at": accessed_at}],
        "limitations": [
            "Yalnızca sağlanan HTML incelendi; JavaScript çalıştırılmadı.",
            "Başlıklar ürün veya özellik olarak doğrulanmadı; menü ve pazarlama metinleri içerebilir.",
            "Fiyat adayları eksik olabilir; paket, varyant, satıcı, kullanım sınırı ve ödeme dönemi doğrulanmalı.",
            "Ürün türü, katalog kapsamı, stok, kargo ve iade bilgileri henüz ayrıştırılmadı.",
            "Şirket/ürün profiline dönüştürme ve kullanıcı doğrulaması henüz yapılmadı."
        ]
    }


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("html", type=Path)
    cli.add_argument("--url", required=True)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    if args.html.stat().st_size > 2_000_000:
        cli.error("HTML dosyası 2 MB sınırını aşıyor.")
    fetched = datetime.fromtimestamp(args.html.stat().st_mtime, timezone.utc).isoformat()
    result = extract_evidence(args.html.read_text(encoding="utf-8"), args.url, fetched)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Kaydedildi: {args.output} ({len(result['section_candidates'])} başlık, {len(result['pricing_candidates'])} fiyat adayı)")


if __name__ == "__main__":
    main()
