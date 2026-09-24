# 对照 GenOffice，办公 agent 还差什么

Audience: Internal
Status: Draft
Last verified: 2026-09-22

这是一份差距清单，不是已经实现的契约。对照的是 `參考/genoffice` 里 agent 实际能调用的办公操作，和 Lyra 现在两个工具 `software__office__read`、`software__office__apply` 的代码路径。日期是 2026-09-22。前十步里能搬过来的操作已在当天的 `office.test.ts` 锁住。印成 PDF 的隐藏渲染进程、完整 Markdown 编辑器，以及 csv、xls、xlsb、ods 互转，没有做。

Lyra 不打算拆成 GenOffice 那一排 MCP 工具。缺的是操作和读到的上下文，不是工具个数。

## 已经接上

Word。读回块序号、批注、脚注尾注、页眉页脚、修订（`id`、`type`、`blockIndex`、`author`，以及有则带上的 `date`、`change`，文字最多 200 字）、节（序号、起止块、纸张和方向）和样式（`styleId`、名字、类型、标题级别）。写入包括改一块文字、插入和替换 HTML、批注、脚注尾注、页眉页脚、字体和段落、标题和列表、查找替换、删块和移块、页面设置、分节、接受和拒绝修订、表格行列和单元格、域和书签、目录、图表、文本框、样式、文字水印和图片水印。本地 png、jpeg、gif 和 data URL 可以插入。http(s) 图片整批拒绝，文档不打开。一批里有一个不允许的操作，整批不写盘。

Excel。`apply` 把操作交给 `@genoffice/xlsx-dsl`，说明文字按 `SUPPORTED_DSL_OPS` 写给模型。单元格、区域、查找替换、排序、格式、合并、行高列宽、插删行列、工作表增删改名，以及图表、改已有图表、图片、形状、表格、批注、筛选、超链接、数据验证、名称、冻结、页面设置、透视表、迷你图、条件格式、隐藏行列、保护、复制和移动工作表，都在这份名单里。读回的是工作表名和有内容的单元格，文字截到 200 字，总共 500 个，外加图表路径（`xl/charts/chartN.xml` 和工作表）、定义名称（名字和引用），以及缓存成错误的公式（`checks`）。`set_formula` 在 sidecar 能导入这份工作簿时回写缓存。`=1+2` 的缓存是 3。sidecar 不会算的函数仍是公式、缓存为空。`convert_to_values` 和源区域含公式的透视表要等公式已经写在磁盘上，再单独一批做。

幻灯片。读回每页元素的 id、类型、文字预览（最多 200 字）和位置（`x`、`y`、`cx`、`cy`，单位 EMU）。有备注的页带上备注文字，同样最多 200 字。每页还有版面检查：出界、文字溢出、重叠，每条带元素 id，几何上能修好的附上 `setTransform`。`set_text` 会改成引擎的 `setText`。其它操作原样交给 `@genoffice/pptx-ops`。说明按文字、元素、插入、表格、页面、整份分组。写错字段时，错误里带该操作的签名。`addPicture`、`replacePicture`、`addMedia`、`addModel3d`、`pasteElements`、`pasteSlide`、`insertSlidePptx`、`setAnimations`、`setChart`、`setImageFill` 不交给模型，因为参数是字节或剪贴板。

PDF 只能在文件树里预览，不能读给 agent，也不能改。

## Word 还差的

表格、域、目录、图表、文本框、样式、水印和本地图片已经放行。还没做的是文档检查（域未更新、坏引用、目录过期、缺图、空图表、空标题、未处理的修订和批注），以及把编辑记成某作者的修订。

## Excel 还差的

公式引擎是 `third_party/genoffice/native/xlsx-engine` 里的 `xlsx-sidecar`（IronCalc）。二进制不在 git 里，要在那个目录 `cargo build --release`，或者设置 `XLSX_SIDECAR_PATH`。sidecar 打不开的工作簿仍只存公式、缓存留空。

远程图片被拒绝。本地 png、jpeg、gif 可以嵌入。GenOffice 还接受 https 地址。

只有打开着的表格编辑器能做、无界面路径也拒绝的：`refresh_pivot`、给已有表格加删行列、`delete_table`、`edit_shape`、`delete_visual`。

读回还看不见筛选、合并、条件格式和数据验证。图表路径和定义名称已经在 read 里。

GenOffice 还有工作表检查（未计算、坏的表引用和名称、图表引用、数字溢出）。Lyra 的 read 只列出缓存成错误的公式。csv、xls、xlsb、ods 和 xlsx 互转没有做。Lyra 只处理 xlsx。

## 幻灯片还差的

读回还没有填充、批注、版式和主题。对齐、动画和主题操作仍然没有这些读结果可以对准。

整份生成走 `build_deck`：路径上还没有 pptx 时，按页规格写出一份新的。`replace_slide` 重做已有文稿里的一页，其它页的元素 id 保留。设计说明和页规格检查没有搬。

GenOffice 还能把每一页渲成 PNG 交回给 agent。Lyra 的文件树预览人能看见，agent 的 read 拿不到这张图。版面检查用的是渲染层的像素框，不是这张图。

## PDF、新建和导出

PDF 页面仍然不能改。`convert_pdf` 读一份 pdf，写出一个还不存在的 docx、pptx 或 xlsx，再用现有 read 看结果。把 md、html、docx、xlsx、pptx 印成 PDF 要启动隐藏的 GenOffice 渲染进程，这一步没有带上。

`create_xlsx` 写出一份空工作簿。`create_docx` 从 Markdown 的标题和段落写出新 docx。参考项目的 `markdownToDocx` 还带表格、图片和图表，那套是 Markdown 应用自己的编辑器，没有整份搬过来。普通的 `set_cell` 或 `set_text` 在文件不存在时仍然不会创建文件。

Excel 的 read 会列出缓存成错误的公式。Word 那份域、引用、目录和缺图检查还绑在参考项目的文档会话上，没有接进 read。

网页搜索、搜图、看媒体、生成图片是 GenOffice agent 的其它工具，不是对办公文件的 read 或 apply。

## 推进步骤

仍是两个工具。一步只打通一类操作。一批里有一个被拒绝的操作，整批不写盘。每步在 `apps/desktop/src/main/office/office.test.ts` 用现有那种小文件锁住结果，然后重启桌面进程，agent 对话才能看见。窗口刷新不够。

不要在同一步里改 Word、Excel、幻灯片。不要为了这些步骤增加第三个工具。网页搜索、搜图、生成图片不在这条线上。

### ✅ ~~1. 把 Excel 已经能做的名字写给模型~~

`apps/desktop/src/main/office/xlsx.ts` 已经把操作交给 `@genoffice/xlsx-dsl`。manifest 的 apply 说明少了条件格式、隐藏行列、工作表隐藏和移动、复制工作表、保护、清除筛选、筛选条件、删除名称、形状、迷你图、`edit_chart`。

改 `apps/desktop/src/modules/workbench/software-capabilities/manifest.ts` 的 apply 说明，按 `third_party/genoffice/packages/xlsx-dsl/src/xlsx-dsl.ts` 里的 `SUPPORTED_DSL_OPS` 写全。补一条测试，对一份小 xlsx 做说明里原先没写、代码已经接受的操作，例如 `set_rows_hidden`，再读回确认那一行不再出现在单元格列表里，或者文件里的隐藏标记在。

`convert_to_values` 名字会进 DSL，然后在 `xlsx-dsl/src/xlsx.ts` 的 `computedValues` 抛出「formula evaluation is not built in」。说明里继续写明它会失败，不要写成已经能算。

做完时，agent 不需要新引擎就能隐藏一行、加条件格式、复制工作表。公式缓存仍是空的。

### ✅ ~~2. Excel 的 read 给出图表路径和名称~~

`edit_chart` 要对着图表部件路径。GenOffice 的 `sheet read` 把路径放在图表摘要里。Lyra 的 `readXlsxBytes` 只返回有内容的单元格。

在已打开的 xlsx 包里列出 `xl/charts/chartN.xml`，连同它所在的工作表，放进 read。定义名称同样从包里读出短列表（名字和引用）。类型加在 `desktop-bridge.ts` 的 xlsx 分支和 manifest 的 read 说明上。单元格上限 500 不变。

验收：一份带图表和定义名称的小 xlsx，read 里能看到 `xl/charts/` 路径和名称。再用这个路径做一次 `edit_chart`，失败则整份不写。纯数值的 `add_pivot` 可以在这一步用测试锁住。源区域里有公式的透视表留到第 8 步。

### ✅ ~~3. 放行 Word 表格、域、目录、图表和文本框~~

这些执行器在 `docx-headless` 里，`session.ts` 的 `ALLOWED` 在 `executeTool` 之前拒绝。

走 `apply_ops` 的：`insertTableRow`、`deleteTableRow`、`insertTableColumn`、`deleteTableColumn`、`mergeTableCells`、`splitTableCell`、`setTableCellFormat`、`setTableStyle`、`insertField`、`insertBookmark`、`updateFields`、`insertToc`、`setImageProperties`。

按原名交给 `executeTool` 的：`insert_chart`、`edit_chart`、`insert_text_box`。图表只用调用里的分类和系列。

`setImageProperties` 先放行，测试留到第 5 步，因为现在的小 docx 没有图片块。

表格测试用一份自带 `w:tbl` 的小 docx。read 里该块的类型应是表格。再 `insertTableRow`，保存后行数增加，原有单元格文字还在。协议写明用 HTML 插进去的表会整表保护，只剩单元格文字可改，所以不要用 `insert_content` 的 `<table>` 当这次验收。

域测试：`insertBookmark` 之后 `insertField` 类型 `REF`，文字留在 `document.xml`。`insertToc` 用有标题的文档，正文出现目录域。`insert_chart` 后包里出现图表部件，分类文字还在。`insert_text_box` 后正文能再读到文本框里的字。同一批夹一个 `insert_image` 仍然不写盘。原有改字、批注、页眉、脚注、粗体、页面方向测试继续通过。

### ✅ ~~4. Word 样式、水印和更全的修订摘要~~

只放行名字不够。`executeTool` 的 extras 现在是空的。参考实现在 `參考/genoffice/packages/cli/src/formats/docx.ts` 的 `docExtras`：`styles.list`、`styles.upsert`，以及 `watermark.current`、`watermark.set`。

把 `styleUpserts` 和 `watermark` 放进 `session.ts` 的侧状态。`save` 在写盘前把挂起的样式折进 `styles.xml`，把水印折进页眉。打开时加载已经 vendored 的 `style-ops`。`define_style`、`list_styles`、`set_watermark` 按原名进 `executeTool`。`applyStyle` 走 `apply_ops`。

read 增加样式短摘要：`styleId`、名字、类型、标题级别。修订摘要补上 `author`、`date`、`change`，文字仍最多 200 字。这样 `accept_changes` 才能按作者或日期挑选。类型跟着改 `desktop-bridge.ts` 和 `genoffice-docx-headless.d.ts`。

验收：`define_style` 之后 `applyStyle` 到第一块，`styles.xml` 里有这个 id，再读能看见它。`set_watermark` 写成文字水印，页眉部件里有这段文字。带作者的 `w:ins`，read 的修订里有这个作者，按作者接受后标记消失、文字留下。图片水印留到第 5 步。

### ✅ ~~5. Word 本地图片~~

沿 Excel 的边界：本地 png、jpeg、gif 可以嵌，http(s) 整批拒绝，文档不打开。

把参考项目 `docx.ts` 里读本地文件、量尺寸、再交给编辑器的那段收进 headless。`insert_image` 和 `insert_picture` 按原名进入。data URL 跟 GenOffice 一样接受。远程地址保持现在的拒绝。

验收：一张临时 png，插到 Hello 后面，再读有图片块，包里有 `word/media`。然后 `setImageProperties` 改宽度，`document.xml` 里的尺寸变了，文字还在。远程 URL 和 `set_text` 放在同一批，文件修改时间不变。文字水印已在第 4 步，这里补一张图片水印，页眉里能看到这张图。

### ✅ ~~6. 幻灯片 read 带上位置和备注~~

`SlideElement` 上已经有 `transform`（`x`、`y`、`cx`、`cy`，单位是 EMU）。`readPptxBytes` 现在丢掉了。备注在幻灯片模型上，read 也没返回。

read 的每个元素加上位置和宽高。有备注的页加上备注文字，同样截到 200 字。`desktop-bridge.ts` 的 pptx 类型和 manifest 的 read 说明跟着改。

67 个操作的签名不要整段贴进 manifest。`pptx-ops` 的 `opUsage` 能给出单个操作的签名。未知操作失败时，把这个签名附在引擎错误后面，模型第一次用错就能看见字段。apply 说明里写明分组：文字、元素、插入、表格、页面、整份。不交给模型的仍是 `addPicture`、`replacePicture`、`addMedia`、`addModel3d`、`pasteElements`、`pasteSlide`、`insertSlidePptx`、`setAnimations`、`setChart`、`setImageFill`，因为参数是字节或剪贴板。

验收：一份有位置和备注的小 pptx，read 的数字和文件里的 EMU 一致，备注文字在。`setTransform` 用读到的 id 挪动元素，再读位置变了。一个写错字段的操作不写盘，错误里有该操作的签名。

### ✅ ~~7. 幻灯片版面检查~~

GenOffice 的 `auditSlideLayout` 吃的是渲染后的像素框，不是 `openPptx` 的 EMU。检查函数在 `參考/genoffice/packages/pipelines/src/slides/layout-audit.ts`。

先用现有引擎把一页画成像素框，再调用这个检查。对不上像素框，就不要用 EMU 除一个常数冒充溢出。检查结果放进 read，每条带元素 id 和建议的 `setTransform`。不要新工具。

验收：一个故意画出页边的元素，read 的检查里有它的 id 和建议操作。按这个操作 apply 之后，同一条检查消失。没有溢出的页，检查是空的。

### ✅ ~~8. 公式要单独决定~~

`third_party/genoffice/packages/xlsx-dsl/src/xlsx.ts` 的 `computedValues` 固定抛错。参考实现在 `參考/genoffice/packages/cli/src/formats/xlsx.ts`：启动 `xlsx-sidecar` 二进制，按区域读回计算结果，单次上限 20000 个单元格。`applyWorkbookOps` 只有拿到磁盘路径才会把这个函数传进去。Lyra 现在传的是内存里的字节，没有路径。

这一步选了 sidecar，没有换别的公式库。二进制在 `third_party/genoffice/native/xlsx-engine`，`cargo build --release` 之后由 apply 找到。打包配置会把它放进桌面应用的 resources。sidecar 不在时，公式照写，缓存留空。

验收只在选择带上 sidecar 之后做：`=1+2` 的缓存值是 3；`convert_to_values` 把公式换成 3；源区域是公式的透视表写出数值。函数 sidecar 不会算的，保持公式、缓存为空。

### ✅ ~~9. 整份幻灯片生成~~

这不是对已有 pptx 的 `apply`。参考入口是 `deck_start`、`deck_page`、`deck_build`、`deck_replace`，规格和设计说明在 `參考/genoffice/packages/pipelines` 的 slides。`slides_replace` 只重做一页，其它页的 id 和内容保持。

等第 6 步和第 7 步的读结果可用，再把这条流水线收进来。生成结果仍是一个 pptx 文件，之后用现有的 read 和 apply 改。不要把大纲 JSON 塞进对 docx 或 xlsx 的 apply。

验收：按一页规格生成一页，read 能看见该页元素。替换其中一页之后，另一页的元素 id 还在。

### ✅ ~~10. PDF 转换和新建文件~~

GenOffice 不修改 PDF 页面。两条路是分开的。

PDF 转成 docx、pptx、xlsx 用的是 `@genoffice/pdf2docx` 和 pdfium。`convert_pdf` 读 pdf 路径，把结果写到另一个还不存在的办公文件，再用现有 read 看。这不是对 PDF 的 apply。

把 md、html、docx、xlsx、pptx 印成 PDF 会启动隐藏的 GenOffice 渲染进程。这一步没有带上那个进程。

`create_xlsx` 用已有的空工作簿。`create_docx` 只接收 Markdown 的标题和段落。参考项目的 `markdownToDocx` 还包含表格、图片和图表，那部分留在 Markdown 应用里，没有搬。文件不存在时，`set_cell` 和 `set_text` 仍然不会创建文件。

Excel read 会列出缓存成错误的公式，不会把每一条还没算出的公式都报成未计算。Word 的域、引用、目录和缺图检查仍绑在参考项目的文档会话上，没有接进 read。

csv、xls、xlsb、ods 与 xlsx 的互转留在第 10 步之后，和新建、导出放在一起。它不改变已经打开的 xlsx 能做的操作。
