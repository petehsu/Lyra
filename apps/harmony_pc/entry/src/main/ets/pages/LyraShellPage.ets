import { AiPanelStub } from '../components/AiPanelStub';
import { TitleBar } from '../components/TitleBar';
import { WorkspaceStub } from '../components/WorkspaceStub';
import { WORKBENCH_LAYOUT, WORKBENCH_LIGHT_TOKENS, WorkbenchTokens } from '../contracts/WorkbenchShellContract';

@Component
export struct LyraShellPage {
  private readonly tokens: WorkbenchTokens = WORKBENCH_LIGHT_TOKENS;

  build() {
    Column() {
      TitleBar()
      Row() {
        Column() {
          AiPanelStub()
        }
        .width(WORKBENCH_LAYOUT.aiPanelWidth)
        .height('100%')
        .border({ width: { right: 1 }, color: this.tokens.appBorder })

        Column() {
          WorkspaceStub()
        }
        .layoutWeight(1)
        .height('100%')
      }
      .layoutWeight(1)
      .width('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.tokens.appBg)
  }
}
