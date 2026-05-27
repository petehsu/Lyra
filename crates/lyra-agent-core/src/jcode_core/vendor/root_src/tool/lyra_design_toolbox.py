import asyncio
import json
import re
import sys
from html import unescape
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from playwright.async_api import async_playwright
except ModuleNotFoundError:
    async_playwright = None


class LyraDesignToolBox:
    BASE_URL = "https://styles.refero.design"

    def __init__(self, headless: bool = True):
        self.headless = headless

    async def search_references(self, query: str, limit: int = 10) -> list[dict[str, str]]:
        if async_playwright is None:
            html = await asyncio.to_thread(self._fetch, f"{self.BASE_URL}/?{urlencode({'q': query})}")
            return _extract_style_cards(html, limit)

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            try:
                page = await browser.new_page()
                await page.goto(f"{self.BASE_URL}/?{urlencode({'q': query})}", wait_until="domcontentloaded")
                await page.wait_for_selector('a[href^="/style/"]', timeout=8000)
                styles = await page.query_selector_all('a[href^="/style/"]')
                results: list[dict[str, str]] = []
                for style in styles[: max(1, min(limit, 25))]:
                    href = await style.get_attribute("href")
                    if not href:
                        continue
                    title_el = await style.query_selector("h3")
                    title = await title_el.inner_text() if title_el else "Unknown"
                    results.append({"title": title.strip(), "id": href.rstrip("/").split("/")[-1]})
                return results
            finally:
                await browser.close()

    async def get_reference_details(self, reference_id: str) -> dict[str, Any]:
        if async_playwright is None:
            html = await asyncio.to_thread(self._fetch, f"{self.BASE_URL}/style/{reference_id}")
            return _extract_style_details(reference_id, html)

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            try:
                page = await browser.new_page()
                await page.goto(f"{self.BASE_URL}/style/{reference_id}", wait_until="domcontentloaded")
                await page.wait_for_selector("h1", timeout=10000)

                title = await page.inner_text("h1")
                img_el = await page.query_selector('img[alt^="Screenshot"]')
                screenshot_url = await img_el.get_attribute("src") if img_el else ""

                tech_data: dict[str, str] = {}
                target_tabs = ["DESIGN.md", "Tailwind v4", "CSS Variables", "Design Tokens"]

                for tab_name in target_tabs:
                    try:
                        tab_btn = page.get_by_role("tab", name=tab_name)
                        if await tab_btn.count() == 0:
                            continue
                        await tab_btn.click(force=True)
                        await page.wait_for_timeout(1200)
                        code_el = page.locator("pre").first()
                        if await code_el.count() > 0:
                            tech_data[tab_name] = await code_el.inner_text()
                    except Exception as error:
                        tech_data[tab_name] = f"Error: {error}"

                return {
                    "id": reference_id,
                    "title": title.strip(),
                    "screenshot_url": screenshot_url or "",
                    "tech_data": tech_data,
                }
            finally:
                await browser.close()

    def _fetch(self, url: str) -> str:
        request = Request(
            url,
            headers={
                "User-Agent": "Lyra-Agent LyraDesign/1.0",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        with urlopen(request, timeout=20) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset, errors="replace")


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.parts.append(data)

    def text(self) -> str:
        return "\n".join(self.parts)


def _html_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return _clean_text(parser.text())


def _clean_text(value: str) -> str:
    value = unescape(value)
    value = value.replace("\\n", "\n").replace('\\"', '"').replace("\\/", "/")
    value = re.sub(r"<[^>]+>", "\n", value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _next_payload_text(html: str) -> str:
    payloads: list[str] = []
    marker = 'self.__next_f.push([1,"'
    start = 0
    while True:
        index = html.find(marker, start)
        if index < 0:
            break
        cursor = index + len(marker)
        escaped = False
        raw: list[str] = []
        while cursor < len(html):
            char = html[cursor]
            if escaped:
                raw.append("\\" + char)
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"' and html.startswith("])</script>", cursor + 1):
                cursor += 1
                break
            else:
                raw.append(char)
            cursor += 1
        encoded = "".join(raw)
        try:
            payloads.append(json.loads(f'"{encoded}"'))
        except json.JSONDecodeError:
            payloads.append(encoded)
        start = cursor
    return "\n".join(payloads)


def _page_text(html: str) -> str:
    return _clean_text("\n".join([_html_text(html), _next_payload_text(html)]))


def _extract_style_cards(html: str, limit: int) -> list[dict[str, str]]:
    limit = max(1, min(limit, 25))
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    pattern = re.compile(r'<a\b[^>]*href="/style/([^"#?]+)"[^>]*>(.*?)</a>', re.DOTALL)
    for match in pattern.finditer(html):
        reference_id = match.group(1).rstrip("/")
        if reference_id in seen:
            continue
        seen.add(reference_id)
        card_html = match.group(2)
        title_match = re.search(r"<h3\b[^>]*>(.*?)</h3>", card_html, re.DOTALL)
        if title_match:
            title = _clean_text(title_match.group(1))
        else:
            alt_match = re.search(r'<img\b[^>]*alt="([^"]+)"', card_html)
            title = _clean_text(alt_match.group(1)) if alt_match else "Unknown"
        results.append({"title": title or "Unknown", "id": reference_id})
        if len(results) >= limit:
            break
    return results


def _extract_style_details(reference_id: str, html: str) -> dict[str, Any]:
    text = _page_text(html)
    title = _extract_title(html, text)
    screenshot_url = _extract_screenshot_url(html)
    tech_data = {
        "DESIGN.md": _extract_design_markdown(text),
        "CSS Variables": _extract_code_after_heading(text, "### CSS Custom Properties"),
        "Tailwind v4": _extract_code_after_heading(text, "### Tailwind v4"),
        "Design Tokens": _extract_tokens_markdown(text),
    }
    tech_data = {key: value for key, value in tech_data.items() if value.strip()}
    if not tech_data:
        tech_data["DESIGN.md"] = text[:20000]
    return {
        "id": reference_id,
        "title": title,
        "screenshot_url": screenshot_url,
        "tech_data": tech_data,
    }


def _extract_title(html: str, text: str) -> str:
    for pattern in [
        r"<h1\b[^>]*>(.*?)</h1>",
        r"<title\b[^>]*>(.*?)</title>",
        r'"name":"([^"]+) design system"',
    ]:
        match = re.search(pattern, html, re.DOTALL)
        if match:
            title = _clean_text(match.group(1))
            return title.replace(" | Lyra Design References", "").strip()
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    return first_line or "Lyra Design Reference"


def _extract_screenshot_url(html: str) -> str:
    match = re.search(r'<img\b[^>]*alt="[^"]*"[^>]*src="([^"]+)"', html)
    if not match:
        return ""
    return unescape(match.group(1))


def _extract_code_after_heading(text: str, heading: str) -> str:
    heading_index = text.find(heading)
    if heading_index < 0:
        return ""
    code_start = text.find("```", heading_index)
    if code_start < 0:
        return ""
    code_start = text.find("\n", code_start)
    if code_start < 0:
        return ""
    code_end = text.find("```", code_start)
    if code_end < 0:
        return ""
    return text[code_start:code_end].strip()


def _extract_between(text: str, start_heading: str, end_headings: list[str]) -> str:
    start = text.find(start_heading)
    if start < 0:
        return ""
    end_candidates = [text.find(heading, start + len(start_heading)) for heading in end_headings]
    end_candidates = [index for index in end_candidates if index >= 0]
    end = min(end_candidates) if end_candidates else len(text)
    return text[start:end].strip()


def _extract_design_markdown(text: str) -> str:
    candidates = [
        _extract_between(text, "## Visual Identity", ["## Quick Start", "## More like this"]),
        _extract_between(text, "## Design System", ["## Quick Start", "## More like this"]),
        _extract_between(text, "## Components", ["## Quick Start", "## More like this"]),
    ]
    content = "\n\n".join(candidate for candidate in candidates if candidate)
    return content or text[:20000]


def _extract_tokens_markdown(text: str) -> str:
    sections = []
    for heading in ["## Surfaces", "## Elevation", "## Imagery", "## Layout", "## Agent Prompt Guide"]:
        section = _extract_between(
            text,
            heading,
            ["## Surfaces", "## Elevation", "## Imagery", "## Layout", "## Agent Prompt Guide", "## Similar Brands", "## Quick Start", "## More like this"],
        )
        if section:
            sections.append(section)
    if sections:
        return "\n\n".join(dict.fromkeys(sections))

    css = _extract_code_after_heading(text, "### CSS Custom Properties")
    tailwind = _extract_code_after_heading(text, "### Tailwind v4")
    return "\n\n".join(part for part in [css, tailwind] if part)


async def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({
            "ok": False,
            "error": "Usage: lyra_design_toolbox.py <search_references|get_reference_details> <json-payload>",
        }))
        return 2

    action = sys.argv[1]
    payload = json.loads(sys.argv[2])
    toolbox = LyraDesignToolBox(headless=payload.get("headless", True) is not False)

    try:
        if action == "search_references":
            query = str(payload.get("query", "")).strip()
            if not query:
                raise ValueError("query is required for search_references")
            result = await toolbox.search_references(query, int(payload.get("limit", 10)))
        elif action == "get_reference_details":
            reference_id = str(payload.get("reference_id", "")).strip()
            if not reference_id:
                raise ValueError("reference_id is required for get_reference_details")
            result = await toolbox.get_reference_details(reference_id)
        else:
            raise ValueError(f"Unsupported action: {action}")

        print(json.dumps({"ok": True, "action": action, "result": result}, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({
            "ok": False,
            "action": action,
            "error": str(error),
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
