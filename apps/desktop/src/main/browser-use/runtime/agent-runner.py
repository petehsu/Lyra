import asyncio
import json
import os
import sys


def _emit(payload):
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


async def main():
    try:
        from browser_use import Agent
        from browser_use.browser import BrowserSession
        from browser_use.llm.openai.chat import ChatOpenAI
    except Exception as exc:
        _emit({
            "ok": False,
            "summary": f"browser-use agent runtime unavailable: {exc}",
            "steps": [],
        })
        return

    cdp_url = os.environ.get("LYRA_BROWSER_USE_CDP_URL")
    task = os.environ.get("LYRA_BROWSER_USE_TASK", "").strip()
    if not task:
        _emit({"ok": False, "summary": "LYRA_BROWSER_USE_TASK is required", "steps": []})
        return

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        _emit({
            "ok": False,
            "summary": "OPENAI_API_KEY is required for browser_use.agent.run in the current Lyra integration.",
            "steps": [],
        })
        return

    max_steps = int(os.environ.get("LYRA_BROWSER_USE_MAX_STEPS", "8"))
    model = os.environ.get("LYRA_BROWSER_USE_MODEL", "gpt-4.1-mini")

    browser_session = BrowserSession(cdp_url=cdp_url) if cdp_url else BrowserSession(headless=False)
    llm = ChatOpenAI(model=model, api_key=api_key)
    agent = Agent(task=task, llm=llm, browser_session=browser_session)

    try:
        history = await agent.run(max_steps=max_steps)
        summary = None
        try:
            final_result = history.final_result()
            if isinstance(final_result, str):
                summary = final_result
        except Exception:
            summary = None
        _emit({
            "ok": True,
            "summary": summary or "browser_use agent task completed",
            "steps": [],
        })
    except Exception as exc:
        _emit({
            "ok": False,
            "summary": str(exc),
            "steps": [],
        })
    finally:
        try:
            await browser_session.kill()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
