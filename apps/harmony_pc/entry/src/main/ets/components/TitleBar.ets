import {
  WORKBENCH_LAYOUT,
  WORKBENCH_LIGHT_TOKENS,
  WORKBENCH_SHELL_CONTRACT_HASH,
  WORKBENCH_TITLEBAR_ACTIONS,
  WorkbenchTokens
} from '../contracts/WorkbenchShellContract';

@Component
export struct TitleBar {
  private readonly tokens: WorkbenchTokens = WORKBENCH_LIGHT_TOKENS;

  @Builder
  private ActionButton(label: string) {
    Text(label)
      .fontSize(12)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.tokens.textSecondary)
      .textAlign(TextAlign.Center)
      .width(label === 'ai' ? 58 : 32)
      .height(26)
      .borderRadius(8)
      .backgroundColor(this.tokens.appInputBg)
      .border({ width: 1, color: this.tokens.appInputBorder })
  }

  build() {
    Row({ space: 10 }) {
      Row({ space: 8 }) {
        Image($r('app.media.app_icon'))
          .width(20)
          .height(20)
          .borderRadius(6)
        Text('Lyra')
          .fontSize(13)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.tokens.textPrimary)
      }
      .width(280)
      .height('100%')
      .alignItems(VerticalAlign.Center)

      Row({ space: 8 }) {
        Text('Search, open files, or run tasks')
          .fontSize(12)
          .fontColor(this.tokens.textMuted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .height(WORKBENCH_LAYOUT.titlebarNavigationHeight)
      .layoutWeight(1)
      .padding({ left: 12, right: 12 })
      .borderRadius(14)
      .backgroundColor(this.tokens.appInputBg)
      .border({ width: 1, color: this.tokens.appInputBorder })
      .alignItems(VerticalAlign.Center)

      Row({ space: 6 }) {
        ForEach(WORKBENCH_TITLEBAR_ACTIONS, (action: string) => {
          this.ActionButton(action)
        }, (action: string) => action)
      }
      .height('100%')
      .alignItems(VerticalAlign.Center)
    }
    .height(WORKBENCH_LAYOUT.titlebarHeight)
    .padding({ left: 10, right: 10 })
    .backgroundColor(this.tokens.appPanelBg)
    .border({ width: { bottom: 1 }, color: this.tokens.appBorder })
    .alignItems(VerticalAlign.Center)
  }
}

export const HARMONY_WORKBENCH_CONTRACT_HASH: string = WORKBENCH_SHELL_CONTRACT_HASH;
