import { WORKBENCH_LIGHT_TOKENS, WorkbenchTokens } from '../contracts/WorkbenchShellContract';

@Component
export struct WorkspaceStub {
  private readonly tokens: WorkbenchTokens = WORKBENCH_LIGHT_TOKENS;

  @Builder
  private Tab(title: string, active: boolean) {
    Text(title)
      .fontSize(12)
      .fontWeight(active ? FontWeight.Medium : FontWeight.Regular)
      .fontColor(active ? this.tokens.textPrimary : this.tokens.textMuted)
      .height(30)
      .padding({ left: 12, right: 12 })
      .borderRadius(8)
      .backgroundColor(active ? this.tokens.appSurfaceStrongBg : 'transparent')
      .border({ width: 1, color: active ? this.tokens.appBorder : 'transparent' })
  }

  @Builder
  private TerminalLine(text: string) {
    Text(text)
      .fontSize(12)
      .fontFamily('monospace')
      .fontColor(this.tokens.textSecondary)
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
  }

  build() {
    Column() {
      Stack() {
        Column({ space: 16 }) {
          Text('Workspace')
            .fontSize(28)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.tokens.textPrimary)
          Text('Browser, files, and Agent-owned surfaces will mount here after the runtime bridge is ready.')
            .fontSize(14)
            .lineHeight(22)
            .fontColor(this.tokens.textSecondary)
            .textAlign(TextAlign.Center)
            .width(520)
          Row({ space: 8 }) {
            Text('lyra://search')
              .fontSize(12)
              .fontColor(this.tokens.textMuted)
          }
          .height(36)
          .padding({ left: 16, right: 16 })
          .borderRadius(18)
          .backgroundColor(this.tokens.appInputBg)
          .border({ width: 1, color: this.tokens.appInputBorder })
          .alignItems(VerticalAlign.Center)
        }
        .alignItems(HorizontalAlign.Center)
      }
      .layoutWeight(1)
      .width('100%')
      .backgroundColor(this.tokens.appBg)

      Row({ space: 4 }) {
        this.Tab('Search', true)
        this.Tab('Files', false)
        this.Tab('Agent', false)
      }
      .width('100%')
      .height(34)
      .padding({ left: 8, right: 8 })
      .backgroundColor(this.tokens.appPanelBg)
      .border({ width: { top: 1 }, color: this.tokens.appBorder })
      .alignItems(VerticalAlign.Center)

      Column({ space: 6 }) {
        this.TerminalLine('$ devecocli build')
        this.TerminalLine('HarmonyOS PC shell contract: linked')
        this.TerminalLine('Agent runtime bridge: not connected in v1')
      }
      .width('100%')
      .height(180)
      .padding({ left: 12, right: 12, top: 10, bottom: 10 })
      .backgroundColor(this.tokens.appPanelBg)
      .border({ width: { top: 1 }, color: this.tokens.appBorder })
    }
    .width('100%')
    .height('100%')
  }
}
