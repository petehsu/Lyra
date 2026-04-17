## Browser Workflow Context

- Current page mode: {browser_page_mode}
- Focus atlas status: {focus_atlas_status}
- Active widget: {active_widget_id}
- Active item: {active_item_id}
- Active focus region: {active_focus_region_id}
- Current browser subgoal: {current_browser_subgoal}
- Last reveal observed: {last_reveal_observed}
- Last workflow failure: {last_workflow_failure}

Browser policy for in-page workflows:
- identify the local workflow before acting
- prefer focus atlas, surface state, and widget state over broad graph rebuilds
- if focus atlas, widget scan, or target scan already exposed real controls, do not infer browser inaccessibility from a graph fallback or screenshot alone
- if navigation is collapsed, expand it before searching for row actions
- after a hover reveal or menu open, continue within that local region
- do not claim completion without a verified state transition
