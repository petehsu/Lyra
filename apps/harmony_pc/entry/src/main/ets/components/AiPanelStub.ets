import { WORKBENCH_LIGHT_TOKENS, WorkbenchTokens } from '../contracts/WorkbenchShellContract';

@Component
export struct AiPanelStub {
  private readonly tokens: WorkbenchTokens = WORKBENCH_LIGHT_TOKENS;

  @Builder
  private SessionTab(title: string, active: boolean) {
    Text(title)
      .fontSize(12)
      .fontColor(active ? this.tokens.textPrimary : this.tokens.textMuted)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .padding({ left: 10, right: 10 })
      .height(30)
      .borderRadius(8)
      .backgroundColor(active ? this.tokens.appRowActiveBg : this.tokens.appRowHoverBg)
  }

  @Builder
  private Message(role: string, text: string) {
    Column({ space: 6 }) {
      Text(role)
        .fontSize(11)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.tokens.textMuted)
      Text(text)
        .fontSize(13)
        .lineHeight(20)
        .fontColor(this.tokens.textPrimary)
    }
    .width('100%')
    .padding(12)
    .borderRadius(10)
    .backgroundColor(this.tokens.appSurfaceBg)
    .border({ width: 1, color: this.tokens.appBorder })
  }

  build() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        this.SessionTab('Design parity', true)
        this.SessionTab('Agent bridge', false)
      }
      .width('100%')

      Column({ space: 10 }) {
        this.Message('Assistant', 'Native HarmonyOS PC shell is tracking the Electron workbench contract.')
        this.Message('User', 'Keep the surface close to desktop Lyra before wiring real runtime.')
      }
      .layoutWeight(1)
      .width('100%')

      Row() {
        Text('Ask Lyra...')
          .fontSize(13)
          .fontColor(this.tokens.textMuted)
          .layoutWeight(1)
        Text('send')
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.tokens.appPrimaryButtonFg)
          .padding({ left: 12, right: 12 })
          .height(28)
          .borderRadius(8)
          .backgroundColor(this.tokens.appPrimaryButton)
      }
      .width('100%')
      .height(42)
      .padding({ left: 12, right: 7 })
      .borderRadius(12)
      .backgroundColor(this.tokens.appInputBg)
      .border({ width: 1, color: this.tokens.appInputBorder })
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height('100%')
    .padding(14)
    .backgroundColor(this.tokens.appSidebarBg)
  }
}
