import { LyraShellPage } from './LyraShellPage';

@Entry
@Component
struct Index {
  build() {
    Column() {
      LyraShellPage()
    }
    .width('100%')
    .height('100%')
  }
}
