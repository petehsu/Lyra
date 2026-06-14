# 视觉

Claude 的视觉能力使其能够理解和分析图像，为多模态交互开启了令人兴奋的可能性。

---

本指南介绍如何在 Claude 中使用图像，包括最佳实践、代码示例以及需要注意的限制。

---

## 如何使用视觉功能 \{#how-to-use-vision}

您可以通过以下方式使用 Claude 的视觉能力：

- [claude.ai](https://claude.ai/)。像上传文件一样上传图像，或直接将图像拖放到聊天窗口中。
- [Console Workbench](/workbench/)。每个 User 消息块的右上角都会出现一个添加图像的按钮。
- API 请求。请参阅本指南中的示例。

单个请求中可以包含多张图像，Claude 在生成回复时会对它们进行联合分析。这对于比较或对比图像非常有用。

---

## 上传前须知 \{#before-you-upload}

### 一般限制 \{#general-limits}

每条消息或每个请求的最大图像数量为：
  - 在 [claude.ai](https://claude.ai/) 上，每条消息 20 张。
  - 通过 API，对于具有 20 万令牌上下文窗口的模型，每个请求 100 张。
  - 通过 API，对于所有其他模型，每个请求 600 张。

每张图像的最大尺寸为 8000x8000 像素。如果您在一个 API 请求中提交超过 20 张图像，此限制将降低至 2000x2000 像素。

每张图像的最大大小为：
  - 直接使用 Claude API 时为 10&nbsp;MB（base64 编码）。
  - 在 Amazon Bedrock 和 Vertex AI 上为 5&nbsp;MB（base64 编码）。
  - 在 [claude.ai](https://claude.ai/) 上为 10&nbsp;MB。

<Note>
虽然 API 支持每个请求最多 600 张图像，但可能会先达到[请求大小限制](/docs/zh-CN/api/overview#request-size-limits)（标准端点为 32&nbsp;MB；某些合作伙伴运营的平台上更低，例如 Amazon Bedrock 和 Vertex AI）。对于大量图像，请考虑使用 [Files API](#files-api-image-example) 上传并通过 `file_id` 引用，以保持请求负载较小。

即使使用 Files API，包含大量大尺寸图像的请求也可能在达到 600 张图像数量之前失败。请在上传前减小图像尺寸或文件大小（例如通过降采样）（参见[评估图像大小](#evaluate-image-size)）。
</Note>

### 评估图像大小 \{#evaluate-image-size}

Claude 以图块（patch）而非像素的方式查看图像。每个图块是图像中 28×28 像素的区块，称为一个视觉令牌（visual token）。因此，一张图像的成本为 `⌈width / 28⌉ × ⌈height / 28⌉` 个视觉令牌。

如果 Claude 收到的图像过大，它会对其进行缩放。最大原生图像分辨率为：

- 对于 Claude Fable 5 和 Claude Mythos 5：4784 个令牌，长边最多 2576 像素。
- 对于 Claude Opus 4.8：4784 个令牌，长边最多 2576 像素。
- 对于 Claude Opus 4.7：4784 个令牌，长边最多 2576 像素。
- 对于其他模型：1568 个令牌，长边最多 1568 像素。

<Note>
如果您的输入图像大于此原生分辨率，它会首先被缩放到保持宽高比的最大可能尺寸。所有图像（无论是否经过缩放）随后都会在底部和右侧边缘填充至 28 像素的倍数。有关确切规则，请参阅 [Claude 如何缩放和填充图像](#how-claude-resizes-and-pads-images)。

当要求 Claude 输出坐标（点、边界框等）时，使用相对于 Claude 所见的缩放后图像的绝对像素坐标效果最佳。有关如何处理此问题，请参阅[处理坐标和边界框](#working-with-coordinates-and-bounding-boxes)。
</Note>

为了最大限度地减少延迟并简化基于坐标的工作流程，建议您在上传图像之前先对其进行缩放。

### 计算图像成本 \{#calculate-image-costs}

您在请求中包含的每张图像都会计入您的令牌使用量。要计算大致成本，请将图像的视觉令牌数量（参见[评估图像大小](#evaluate-image-size)）乘以您所使用[模型的每令牌价格](https://claude.com/pricing)。

以下是在 API 大小限制范围内，基于 Claude Sonnet 4.6 每百万输入令牌 3 美元的价格，不同图像尺寸的令牌化和大致成本示例：

| 图像尺寸                    | 令牌数量 | 每张图像成本 | 每 1000 张图像成本 |
| ----------------------------- | ------------ | ------------ | ---------------- |
| 200x200 px（0.04 百万像素）   | 64           | \~$0.00019   | \~$0.19          |
| 1000x1000 px（1 百万像素）     | 1296         | \~$0.0039    | \~$3.89          |
| 1092x1092 px（1.19 百万像素） | 1521         | \~$0.0046    | \~$4.56          |
| 1920x1080 px（2.07 百万像素） | 1560         | \~$0.0047    | \~$4.68          |
| 2000x1500 px（3 百万像素）    | 1564         | \~$0.0047    | \~$4.69          |
| 3840x2160 px（8.29 百万像素） | 1560         | \~$0.0047    | \~$4.68          |

请注意，最后三张图像超出了原生分辨率，在处理前会被缩小（分别缩小至 1456x819 px、1270x952 px 和 1456x819 px），这限制了它们的令牌成本上限。4K 图像的成本不会超过 1920x1080 图像，因为两者都缩小到相同的尺寸；额外的分辨率会被丢弃。

#### 高分辨率图像支持 \{#high-resolution-image-support-on-claude-opus-4-7}

Claude Opus 4.7 是首个支持高分辨率图像的 Claude 模型；Claude Opus 4.8、Claude Fable 5、Claude Mythos 5 及更高版本的模型也支持此功能。最大图像分辨率为长边 2576 像素，高于之前模型的 1568 像素。这为视觉密集型工作负载带来了性能提升，对于计算机使用、屏幕截图理解和文档分析尤为有价值。

高分辨率支持在 Claude Opus 4.7 及更高版本的模型上自动启用，无需 beta 标头或客户端选择加入。

在 Claude Opus 4.7、Claude Opus 4.8、Claude Fable 5 和 Claude Mythos 5 上，高分辨率图像使用的图像令牌最多可达之前模型的约 3 倍（每张图像 4784 个令牌对比 1568 个令牌）。如果您不需要额外的保真度，请在发送前对图像进行降采样以控制令牌成本。

以下是基于 Claude Opus 4.7 和 Claude Opus 4.8 每百万输入令牌 5 美元的价格，相同图像尺寸的令牌化情况：

| 图像尺寸                    | 令牌数量 | 每张图像成本 | 每 1000 张图像成本 |
| ----------------------------- | ------------ | ------------ | ---------------- |
| 200x200 px（0.04 百万像素）   | 64           | \~$0.00032   | \~$0.32          |
| 1000x1000 px（1 百万像素）     | 1296         | \~$0.0065    | \~$6.48          |
| 1092x1092 px（1.19 百万像素） | 1521         | \~$0.0076    | \~$7.61          |
| 1920x1080 px（2.07 百万像素） | 2691         | \~$0.013     | \~$13.46         |
| 2000x1500 px（3 百万像素）    | 3888         | \~$0.019     | \~$19.44         |
| 3840x2160 px（8.29 百万像素） | 4784         | \~$0.024     | \~$23.92         |

只有最后一张图像超出了更高的限制：4K 图像在处理前被缩小至 2576x1449 px。高分辨率支持提高了分辨率限制，但并未取消限制；长边超过 2576 像素（或 4784 个视觉令牌）的图像仍会被缩小。

### 确保图像质量 \{#ensure-image-quality}

向 Claude 提供图像时，请牢记以下几点以获得最佳效果：

- **图像格式**：使用支持的图像格式：JPEG、PNG、GIF 或 WebP。\
  不支持动画，仅会使用第一帧。
- **图像清晰度**：确保图像清晰，不要过于模糊或像素化。
- **文本**：如果图像包含重要文本，请确保文本清晰可读且不要太小。避免为了放大文本而裁剪掉关键的视觉上下文。
- **缩放**：请考虑到如果图像过大可能会被缩放（见上文）；例如，这可能会使文本变得不易辨认。请考虑预先缩放图像、裁剪图像或两者兼用。
- **图像压缩**：在发送图像之前使用有损格式（如 JPEG 或 WebP 有损模式）对其进行压缩，可以通过减小请求大小来降低延迟。但是，这可能会引入对模型性能有害的伪影，尤其是在应用多次压缩时。例如，重度 JPEG 压缩可能会使文本难以阅读。请通过检查实际发送到 API 的图像来确认您的压缩设置适合当前任务。

---

## 处理坐标和边界框 \{#working-with-coordinates-and-bounding-boxes}

Claude 可以定位和标记图像中的区域（例如，返回表格、表单字段、图表元素或 UI 组件的边界框）。

<Note>
**Claude 在使用绝对像素坐标时效果最佳。** 请在提示中明确要求使用绝对像素坐标。例如：*"以像素坐标形式返回每个表格的边界框，格式为 `[x1, y1, x2, y2]`。"* 当您要求使用归一化坐标时，Claude 的表现不佳，例如：*"返回 `0` 到 `1000` 之间的边界框坐标。"* 请始终要求像素坐标，如有需要，在您自己的代码中进行归一化。
</Note>

坐标遵循标准图像约定：原点 `(0, 0)` 位于图像的左上角，x 向右递增，y 向下递增。Claude 返回的坐标是 Claude 所见图像中的像素位置：即 Claude 将您的图像缩放以适应模型原生分辨率后的图像（参见 [Claude 如何缩放和填充图像](#how-claude-resizes-and-pads-images)）。要获得可直接使用的坐标，您可以预先缩放图像，使坐标与您手中的图像一一对应（参见[上传前缩放图像](#resize-your-image-before-uploading)），或者重新缩放 Claude 返回的坐标（参见[无法预先缩放时重新缩放坐标](#rescale-coordinates-when-you-cannot-pre-resize)）。

<Note>
Claude 的空间推理能力存在局限（参见[限制](#limitations)）。当您在提示中说明预期的坐标格式并在大规模处理前对结果进行可视化抽查时，坐标准确性最佳。对于 [PDF 上传](/docs/zh-CN/build-with-claude/pdf-support)，页面会在服务器端以您无法控制的尺寸光栅化为图像，因此返回的坐标无法可靠地映射回页面。要在 PDF 内容上使用坐标，请自行将页面光栅化为图像，并使用预先缩放的方法。
</Note>

### Claude 如何缩放和填充图像 \{#how-claude-resizes-and-pads-images}

Claude 会找到同时满足模型两个图像限制的最大保持宽高比的尺寸：

1. **边长限制：** 任何一边都不超过最大边长（大多数模型为 1568 px，Claude Opus 4.7 及更高版本的模型为 2576 px）。
2. **视觉令牌限制：** 图像的令牌成本 `⌈width / 28⌉ × ⌈height / 28⌉` 不超过模型的视觉令牌预算（大多数模型为 1568 个令牌，Claude Opus 4.7 及更高版本的模型为 4784 个）。

对于大多数照片和屏幕截图，触发缩放的是边长限制。对于纵向文档，通常是视觉令牌限制先触发，而忽略这一点是导致坐标错位的最常见原因。例如，以 130 DPI 扫描的 A4 页面为 1075×1520 像素：两边都小于 1568 px，但它需要 `39 × 55 = 2145` 个视觉令牌，因此 Claude 会将其缩放至 924×1307。

然后，Claude 会对每张图像（无论是否经过缩放）在底部和右侧边缘填充至下一个 28 像素的倍数（在上例中，924×1307 变为 924×1316）。填充部分不包含任何内容：Claude 感知的是填充后的图像，但页面内容仅占据未填充的缩放区域。**始终按缩放后的尺寸（而非填充后的尺寸）进行归一化或重新缩放**；除以填充后的尺寸会使每个坐标产生微小的偏差。

### 上传前缩放图像 \{#resize-your-image-before-uploading}

最可靠的方法是在上传前自行缩放图像，这样您手中的图像就是 Claude 所见的图像，Claude 返回的坐标无需转换。

以下参考实现计算 Claude 将图像缩放到的确切尺寸：

```python
import math


def count_image_tokens(width: int, height: int) -> int:
    """Visual tokens consumed by an image: one token per 28x28 pixel patch."""
    return math.ceil(width / 28) * math.ceil(height / 28)


def resized_size(
    width: int,
    height: int,
    max_edge: int = 1568,
    max_tokens: int = 1568,
) -> tuple[int, int]:
    """The size Claude resizes an image to before padding.

    Defaults are for most models. For Claude Opus 4.7 and later models, use
    max_edge=2576 and max_tokens=4784. Returns (width, height). Images that
    already fit within the limits are returned unchanged.
    """

    def fits(w: int, h: int) -> bool:
        return (
            math.ceil(w / 28) * 28 <= max_edge
            and math.ceil(h / 28) * 28 <= max_edge
            and count_image_tokens(w, h) <= max_tokens
        )

    if fits(width, height):
        return (width, height)
    if height > width:
        resized_h, resized_w = resized_size(height, width, max_edge, max_tokens)
        return (resized_w, resized_h)

    # 沿长边进行二分查找，找出保持宽高比且能容纳的最大
    # 尺寸。
    aspect_ratio = width / height
    lo, hi = 1, width  # lo always fits; hi never fits
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if fits(mid, max(round(mid / aspect_ratio), 1)):
            lo = mid
        else:
            hi = mid
    return (lo, max(round(lo / aspect_ratio), 1))


# 来自"Claude 如何调整图像大小和填充"的 A4 示例：
print(resized_size(1075, 1520))  # (924, 1307)
```

1. 将图像缩放到 `resized_size` 返回的尺寸。如果图像已经符合模型的限制，`resized_size` 会原样返回其尺寸，无需缩放。
2. 将缩放后的图像发送到 API。不要自行填充；Claude 会处理填充，且填充不会移动坐标原点。
3. 在提示中明确要求像素坐标。例如：*"以像素坐标形式返回每个表格的边界框，格式为 `[x1, y1, x2, y2]`。"*
4. 直接将返回的坐标应用于您发送的图像。如果您需要归一化坐标，请除以您发送的图像的尺寸，而不是原始图像的尺寸，也不是填充后的尺寸。

### 无法预先缩放时重新缩放坐标 \{#rescale-coordinates-when-you-cannot-pre-resize}

如果您无法预先缩放（例如，当图像来自您无法修改的上游系统时），请使用[上传前缩放图像](#resize-your-image-before-uploading)中的 `resized_size` 来恢复 Claude 所见的尺寸，然后将 Claude 返回的坐标映射为归一化坐标或映射回您的原始图像。此方法需要知道您上传的图像的像素尺寸，因此不适用于 PDF 上传。

```python
def to_relative_coordinates(
    x: float,
    y: float,
    original_width: int,
    original_height: int,
    max_edge: int = 1568,
    max_tokens: int = 1568,
) -> tuple[float, float]:
    """Map a pixel coordinate returned by Claude to relative coordinates in [0, 1].

    Pass the dimensions of the image you uploaded. For Claude Opus 4.7 and
    later models, use max_edge=2576 and max_tokens=4784.
    """
    resized_w, resized_h = resized_size(
        original_width, original_height, max_edge, max_tokens
    )
    return (x / resized_w, y / resized_h)


# 要将坐标转换为原始图像的像素空间，请将
# 相对坐标乘以原始尺寸：
# (rel_x * original_width, rel_y * original_height)
```

填充仅应用于底部和右侧边缘，因此原点不会移动，按轴进行线性重新缩放即可。

---

## 提示示例 \{#prompt-examples}

许多适用于与 Claude 进行基于文本交互的[提示技巧](/docs/zh-CN/build-with-claude/prompt-engineering/overview)也可以应用于基于图像的提示。

这些示例演示了涉及图像的最佳实践提示结构。

<Tip>
  正如[将长文档放在查询之前](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#long-context-prompting)可以改善文本提示的结果一样，当图像位于文本之前时，Claude 的表现最佳。放在文本之后或与文本交错的图像仍然表现良好，但如果您的用例允许，请优先采用先图像后文本的结构。
</Tip>

### 关于提示示例 \{#about-the-prompt-examples}

以下示例演示了如何使用各种编程语言和方法来使用 Claude 的视觉能力。您可以通过三种方式向 Claude 提供图像：

1. 在 `image` 内容块中作为 base64 编码的图像
2. 作为指向在线托管图像的 URL 引用
3. 使用 Files API（上传一次，多次使用）

<Note>
在 Amazon Bedrock 和 Vertex AI 上，目前仅支持 base64 编码的来源。
</Note>

base64 示例提示使用以下变量：

<CodeGroup>
```bash cURL
    # 对于基于 URL 的图片，您可以直接在 JSON 请求中使用该 URL

    # 对于 base64 编码的图片，您需要先对图片进行编码
    # 以下是在 bash 中将图片编码为 base64 的示例：
    BASE64_IMAGE_DATA=$(curl -s "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg" | base64)

    # 编码后的数据现在可以在您的 API 调用中使用
```

```python Python
import base64
import httpx

# 对于 base64 编码的图片
image1_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
image1_media_type = "image/jpeg"
image1_data = base64.standard_b64encode(httpx.get(image1_url).content).decode("utf-8")

image2_url = "https://upload.wikimedia.org/wikipedia/commons/b/b5/Iridescent.green.sweat.bee1.jpg"
image2_media_type = "image/jpeg"
image2_data = base64.standard_b64encode(httpx.get(image2_url).content).decode("utf-8")

# 对于基于 URL 的图片，您可以在请求中直接使用 URL
```

```typescript TypeScript nocheck
import axios from "axios";

// 对于 base64 编码的图像
async function getBase64Image(url: string): Promise<string> {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(response.data, "binary").toString("base64");
}

// 用法
async function prepareImages() {
  const imageData = await getBase64Image(
    "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
  );
  // 现在您可以在 API 调用中使用 imageData
}

// 对于基于 URL 的图像，您可以直接在请求中使用 URL
```

```csharp C#
using System;
using System.Net.Http;
using System.Threading.Tasks;

// 对于 base64 编码的图片
async Task<string> DownloadAndEncodeImageAsync(string url)
{
    using var client = new HttpClient();
    var bytes = await client.GetByteArrayAsync(url);
    return Convert.ToBase64String(bytes);
}

// 用法：
// var imageData = await DownloadAndEncodeImageAsync("https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg");
// 对于基于 URL 的图片，您可以在请求中直接使用 URL
```

```go Go hidelines={1..9,-8..}
package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
)

func downloadAndEncodeImage(url string) (string, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "AnthropicDocsBot/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(data), nil
}

func main() {
	imageData, err := downloadAndEncodeImage("https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg")
	if err != nil {
		panic(err)
	}
	fmt.Println(imageData[:50])
}
```

```java Java nocheck hidelines={1..7,-1}
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.Base64;

public class ImageHandlingExample {

  public static void main(String[] args) throws IOException, InterruptedException {
    // 对于 base64 编码的图像
    String image1Url =
      "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
    String image1MediaType = "image/jpeg";
    String image1Data = downloadAndEncodeImage(image1Url);

    String image2Url =
      "https://upload.wikimedia.org/wikipedia/commons/b/b5/Iridescent.green.sweat.bee1.jpg";
    String image2MediaType = "image/jpeg";
    String image2Data = downloadAndEncodeImage(image2Url);

    // 对于基于 URL 的图像，您可以在请求中直接使用 URL
  }

  private static String downloadAndEncodeImage(String imageUrl) throws IOException {
    try (InputStream inputStream = new URL(imageUrl).openStream()) {
      return Base64.getEncoder().encodeToString(inputStream.readAllBytes());
    }
  }
}
```

```php PHP nocheck hidelines={1}
<?php
// 对于 base64 编码的图像
function downloadAndEncodeImage($url) {
    $imageData = file_get_contents($url);
    return base64_encode($imageData);
}

$image1Url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
$image1MediaType = "image/jpeg";
$image1Data = downloadAndEncodeImage($image1Url);

// 对于基于 URL 的图像，您可以在请求中直接使用 URL
```

```ruby Ruby
require "base64"
require "net/http"
require "uri"

# 对于 base64 编码的图像
def download_and_encode_image(url)
  uri = URI.parse(url)
  response = Net::HTTP.get_response(uri)
  Base64.strict_encode64(response.body)
end

image1_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
image1_media_type = "image/jpeg"
image1_data = download_and_encode_image(image1_url)

# 对于基于 URL 的图像，您可以在请求中直接使用 URL
```
</CodeGroup>

以下是如何使用 base64 编码图像和 URL 引用在 Messages API 请求中包含图像的示例：

### Base64 编码图像示例 \{#base64-encoded-image-example}

<CodeGroup>
    ```bash cURL hidelines={1..2}
    BASE64_IMAGE_DATA=$(curl -s "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg" | base64 | tr -d '\n')

    curl https://api.anthropic.com/v1/messages \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "content-type: application/json" \
      -d @- <<EOF
    {
      "model": "claude-opus-4-8",
      "max_tokens": 1024,
      "messages": [
        {
          "role": "user",
          "content": [
            {
              "type": "image",
              "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": "$BASE64_IMAGE_DATA"
              }
            },
            {
              "type": "text",
              "text": "Describe this image."
            }
          ]
        }
      ]
    }
    EOF
    ```
    ```bash CLI
    curl -sSo ./image.jpg \
      https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg

    ant messages create <<'YAML'
    model: claude-opus-4-8
    max_tokens: 1024
    messages:
      - role: user
        content:
          - type: image
            source:
              type: base64
              media_type: image/jpeg
              data: "@./image.jpg"
          - type: text
            text: Describe this image.
    YAML
    ```
    ```python Python hidelines={1..2}
    import anthropic

    image1_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    image1_media_type = "image/png"

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image1_media_type,
                            "data": image1_data,
                        },
                    },
                    {"type": "text", "text": "Describe this image."},
                ],
            }
        ],
    )
    print(message)
    ```
    
    ```typescript TypeScript nocheck hidelines={1..2}
    import Anthropic from "@anthropic-ai/sdk";

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageData // Base64-encoded image data as string
              }
            },
            {
              type: "text",
              text: "Describe this image."
            }
          ]
        }
      ]
    });

    console.log(message);
    ```
    ```csharp C#
    using System.Collections.Generic;
    using Anthropic;
    using Anthropic.Models.Messages;

    AnthropicClient client = new();

    string imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

    var message = await client.Messages.Create(new MessageCreateParams
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 1024,
        Messages =
        [
            new()
            {
                Role = Role.User,
                Content = new MessageParamContent(new List<ContentBlockParam>
                {
                    new ContentBlockParam(new ImageBlockParam(
                        new ImageBlockParamSource(new Base64ImageSource()
                        {
                            Data = imageData,
                            MediaType = MediaType.ImagePng,
                        })
                    )),
                    new ContentBlockParam(new TextBlockParam("Describe this image.")),
                }),
            }
        ]
    });

    Console.WriteLine(message);
    ```
    ```go Go hidelines={1..11,-1}
    package main

    import (
    	"context"
    	"fmt"
    	"log"

    	"github.com/anthropics/anthropic-sdk-go"
    )

    func main() {
    	client := anthropic.NewClient()

    	imageData := "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

    	message, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
    		Model:     anthropic.ModelClaudeOpus4_8,
    		MaxTokens: 1024,
    		Messages: []anthropic.MessageParam{
    			anthropic.NewUserMessage(
    				anthropic.NewImageBlockBase64("image/png", imageData),
    				anthropic.NewTextBlock("Describe this image."),
    			),
    		},
    	})
    	if err != nil {
    		log.Fatal(err)
    	}

    	fmt.Println(message)
    }
    ```

    
    ```java Java nocheck hidelines={1..8,-2..}
    import com.anthropic.client.AnthropicClient;
    import com.anthropic.client.okhttp.AnthropicOkHttpClient;
    import com.anthropic.models.messages.*;
    import java.util.List;

    public class VisionExample {

      public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();
        String imageData = ""; // Base64-encoded image data as string

        List<ContentBlockParam> contentBlockParams = List.of(
          ContentBlockParam.ofImage(
            ImageBlockParam.builder()
              .source(
                Base64ImageSource.builder()
                  .mediaType(Base64ImageSource.MediaType.IMAGE_JPEG)
                  .data(imageData)
                  .build()
              )
              .build()
          ),
          ContentBlockParam.ofText(TextBlockParam.builder().text("Describe this image.").build())
        );
        Message message = client
          .messages()
          .create(
            MessageCreateParams.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .addUserMessageOfBlockParams(contentBlockParams)
              .build()
          );

        System.out.println(message);
      }
    }
    ```
    ```php PHP hidelines={1..4}
    <?php

    use Anthropic\Client;

    $client = new Client();

    $imageData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

    $message = $client->messages->create(
        maxTokens: 1024,
        messages: [
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'image',
                        'source' => [
                            'type' => 'base64',
                            'media_type' => 'image/png',
                            'data' => $imageData,
                        ],
                    ],
                    ['type' => 'text', 'text' => 'Describe this image.'],
                ],
            ],
        ],
        model: 'claude-opus-4-8',
    );

    echo $message->content[0]->text;
    ```
    ```ruby Ruby hidelines={1..2}
    require "anthropic"

    client = Anthropic::Client.new

    image_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"

    message = client.messages.create(
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: image_data
              }
            },
            { type: "text", text: "Describe this image." }
          ]
        }
      ]
    )

    puts message
    ```
</CodeGroup>

### 基于 URL 的图像示例 \{#url-based-image-example}

<CodeGroup>
    ```bash cURL
    curl https://api.anthropic.com/v1/messages \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "content-type: application/json" \
      -d '{
        "model": "claude-opus-4-8",
        "max_tokens": 1024,
        "messages": [
          {
            "role": "user",
            "content": [
              {
                "type": "image",
                "source": {
                  "type": "url",
                  "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
                }
              },
              {
                "type": "text",
                "text": "Describe this image."
              }
            ]
          }
        ]
      }'
    ```
    ```bash CLI
    ant messages create <<'YAML'
    model: claude-opus-4-8
    max_tokens: 1024
    messages:
      - role: user
        content:
          - type: image
            source:
              type: url
              url: https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg
          - type: text
            text: Describe this image.
    YAML
    ```
    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                        },
                    },
                    {"type": "text", "text": "Describe this image."},
                ],
            }
        ],
    )
    print(message)
    ```
    ```typescript TypeScript hidelines={1..2}
    import Anthropic from "@anthropic-ai/sdk";

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "url",
                url: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
              }
            },
            {
              type: "text",
              text: "Describe this image."
            }
          ]
        }
      ]
    });

    console.log(message);
    ```
    ```csharp C#
    using System.Collections.Generic;
    using Anthropic;
    using Anthropic.Models.Messages;

    AnthropicClient client = new();

    var message = await client.Messages.Create(new MessageCreateParams
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 1024,
        Messages =
        [
            new()
            {
                Role = Role.User,
                Content = new MessageParamContent(new List<ContentBlockParam>
                {
                    new ContentBlockParam(new ImageBlockParam(
                        new ImageBlockParamSource(new UrlImageSource()
                        {
                            Url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                        })
                    )),
                    new ContentBlockParam(new TextBlockParam("Describe this image.")),
                }),
            }
        ]
    });

    Console.WriteLine(message);
    ```
    ```go Go hidelines={1..11,-1}
    package main

    import (
    	"context"
    	"fmt"
    	"log"

    	"github.com/anthropics/anthropic-sdk-go"
    )

    func main() {
    	client := anthropic.NewClient()

    	message, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
    		Model:     anthropic.ModelClaudeOpus4_8,
    		MaxTokens: 1024,
    		Messages: []anthropic.MessageParam{
    			anthropic.NewUserMessage(
    				anthropic.NewImageBlock(anthropic.URLImageSourceParam{
    					URL: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
    				}),
    				anthropic.NewTextBlock("Describe this image."),
    			),
    		},
    	})
    	if err != nil {
    		log.Fatal(err)
    	}

    	fmt.Println(message)
    }
    ```
    ```java Java hidelines={1..9,-2..}
    import com.anthropic.client.AnthropicClient;
    import com.anthropic.client.okhttp.AnthropicOkHttpClient;
    import com.anthropic.models.messages.*;
    import java.io.IOException;
    import java.util.List;

    public class VisionExample {

      public static void main(String[] args) throws IOException, InterruptedException {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        List<ContentBlockParam> contentBlockParams = List.of(
          ContentBlockParam.ofImage(
            ImageBlockParam.builder()
              .source(
                UrlImageSource.builder()
                  .url(
                    "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
                  )
                  .build()
              )
              .build()
          ),
          ContentBlockParam.ofText(TextBlockParam.builder().text("Describe this image.").build())
        );
        Message message = client
          .messages()
          .create(
            MessageCreateParams.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .addUserMessageOfBlockParams(contentBlockParams)
              .build()
          );
        System.out.println(message);
      }
    }
    ```
    ```php PHP hidelines={1..4}
    <?php

    use Anthropic\Client;

    $client = new Client();

    $message = $client->messages->create(
        maxTokens: 1024,
        messages: [
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'image',
                        'source' => [
                            'type' => 'url',
                            'url' => 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg',
                        ],
                    ],
                    ['type' => 'text', 'text' => 'Describe this image.'],
                ],
            ],
        ],
        model: 'claude-opus-4-8',
    );

    echo $message->content[0]->text;
    ```
    ```ruby Ruby hidelines={1..2}
    require "anthropic"

    client = Anthropic::Client.new

    message = client.messages.create(
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "url",
                url: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
              }
            },
            { type: "text", text: "Describe this image." }
          ]
        }
      ]
    )

    puts message
    ```
</CodeGroup>

### Files API 图像示例 \{#files-api-image-example}

对于您将重复使用的图像，或者当您希望避免编码开销时，请使用 [Files API](/docs/zh-CN/build-with-claude/files)。上传图像一次，然后在后续消息中引用返回的 `file_id`，而无需重新发送 base64 数据。

<Tip>
  在多轮对话和智能体工作流中，每个请求都会重新发送完整的对话历史记录。如果图像是 base64 编码的，则每轮的负载中都会包含完整的图像字节，随着对话的增长，这可能会显著增加请求大小和延迟。将图像上传到 Files API 并通过 `file_id` 引用它们，无论对话历史记录中累积了多少图像，都能保持请求负载较小。
</Tip>

<CodeGroup>
```bash cURL hidelines={1..2}
cd "$(mktemp -d)"
curl -sSo image.jpg https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg
# 首先，将您的图片上传到 Files API
curl -X POST https://api.anthropic.com/v1/files \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -F "file=@image.jpg"

# 然后在您的消息中使用返回的 file_id
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "image",
            "source": {
              "type": "file",
              "file_id": "file_abc123"
            }
          },
          {
            "type": "text",
            "text": "Describe this image."
          }
        ]
      }
    ]
  }'
```

```bash CLI nocheck hidelines={1}
cd "$(mktemp -d)"
curl -sSo image.jpg \
  https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg

# 首先，将您的图像上传到 Files API
FILE_ID=$(ant beta:files upload \
  --file ./image.jpg \
  --transform id --raw-output)

# 然后在您的消息中使用返回的 file_id
ant beta:messages create \
  --beta files-api-2025-04-14 \
  --transform content --format yaml <<YAML
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content:
      - type: image
        source:
          type: file
          file_id: $FILE_ID
      - type: text
        text: Describe this image.
YAML
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 上传图片文件
with open("image.jpg", "rb") as f:
    file_upload = client.beta.files.upload(file=("image.jpg", f, "image/jpeg"))

# 在消息中使用已上传的文件
message = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    betas=["files-api-2025-04-14"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "file", "file_id": file_upload.id},
                },
                {"type": "text", "text": "Describe this image."},
            ],
        }
    ],
)

print(message.content)
```

```typescript TypeScript nocheck
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "fs";

const anthropic = new Anthropic();

// 上传图像文件
const fileUpload = await anthropic.beta.files.upload({
  file: await toFile(fs.createReadStream("image.jpg"), undefined, { type: "image/jpeg" })
});

// 在消息中使用已上传的文件
const response = await anthropic.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  betas: ["files-api-2025-04-14"],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "file",
            file_id: fileUpload.id
          }
        },
        {
          type: "text",
          text: "Describe this image."
        }
      ]
    }
  ]
});

console.log(response);
```

```csharp C# nocheck
using Anthropic;

var client = new AnthropicClient();

// 上传图片文件
var fileUpload = await client.Beta.Files.Upload(
    new FileUploadParams { File = File.OpenRead("image.jpg") });

// 在消息中使用已上传的文件
var response = await client.Beta.Messages.Create(
    new MessageCreateParams
    {
        Model = "claude-opus-4-8",
        MaxTokens = 1024,
        Betas = new[] { "files-api-2025-04-14" },
        Messages = new[]
        {
            new BetaMessageParam
            {
                Role = "user",
                Content = new object[]
                {
                    new
                    {
                        type = "image",
                        source = new { type = "file", file_id = fileUpload.Id }
                    },
                    new { type = "text", text = "Describe this image." }
                }
            }
        }
    });

Console.WriteLine(response);
```

```go Go nocheck hidelines={1..12,-1}
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	// 上传图像文件
	file, err := os.Open("image.jpg")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	fileUpload, err := client.Beta.Files.Upload(context.Background(),
		anthropic.BetaFileUploadParams{
			File: file,
		})
	if err != nil {
		log.Fatal(err)
	}

	// 在消息中使用已上传的文件
	message, err := client.Beta.Messages.New(context.Background(),
		anthropic.BetaMessageNewParams{
			Model:     anthropic.ModelClaudeOpus4_8,
			MaxTokens: 1024,
			Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaFilesAPI2025_04_14},
			Messages: []anthropic.BetaMessageParam{
				anthropic.NewBetaUserMessage(
					anthropic.NewBetaImageBlock(anthropic.BetaFileImageSourceParam{
						FileID: fileUpload.ID,
					}),
					anthropic.NewBetaTextBlock("Describe this image."),
				),
			},
		})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(message.Content)
}
```

```java Java nocheck hidelines={1..2,5..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.files.FileMetadata;
import com.anthropic.models.beta.files.FileUploadParams;
import com.anthropic.models.messages.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

public class ImageFilesExample {

  public static void main(String[] args) throws IOException {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 上传图片文件
    FileMetadata file = client
      .beta()
      .files()
      .upload(
        FileUploadParams.builder().file(Files.newInputStream(Path.of("image.jpg"))).build()
      );

    // 在消息中使用已上传的文件
    ImageBlockParam imageParam = ImageBlockParam.builder().fileSource(file.id()).build();

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofImage(imageParam),
          ContentBlockParam.ofText(
            TextBlockParam.builder().text("Describe this image.").build()
          )
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message.content());
  }
}
```

```php PHP nocheck hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

// 上传图像文件
$fileUpload = $client->beta->files->upload(
    file: fopen('image.jpg', 'r'),
);

// 在消息中使用已上传的文件
$message = $client->beta->messages->create(
    maxTokens: 1024,
    messages: [
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'image',
                    'source' => ['type' => 'file', 'file_id' => $fileUpload->id],
                ],
                ['type' => 'text', 'text' => 'Describe this image.'],
            ],
        ],
    ],
    model: 'claude-opus-4-8',
    betas: ['files-api-2025-04-14'],
);

echo $message->content[0]->text;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 上传图片文件
file_upload = client.beta.files.upload(
  file: File.open("image.jpg", "rb")
)

# 在消息中使用已上传的文件
message = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  betas: ["files-api-2025-04-14"],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "file", file_id: file_upload.id }
        },
        { type: "text", text: "Describe this image." }
      ]
    }
  ]
)

puts message.content
```
</CodeGroup>

有关更多示例代码和参数详情，请参阅 [Messages API 示例](/docs/zh-CN/api/messages/create)。

<section title="示例：单张图像">

最好将图像放在提示中早于关于图像的问题或使用图像的任务指令的位置。

要求 Claude 描述一张图像。

| 角色 | 内容                        |
| ---- | ------------------------------ |
| User | \[图像\] 描述这张图像。 |

<Tabs>
  <Tab title="使用 Base64">
    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()
    image1_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    image1_media_type = "image/png"

    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image1_media_type,
                            "data": image1_data,
                        },
                    },
                    {"type": "text", "text": "Describe this image."},
                ],
            }
        ],
    )
    ```
  </Tab>
  <Tab title="使用 URL">
    ```python Python
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                        },
                    },
                    {"type": "text", "text": "Describe this image."},
                ],
            }
        ],
    )
    ```
  </Tab>
</Tabs>

</section>
<section title="示例：多张图像">

在有多张图像的情况下，请使用 `Image 1:` 和 `Image 2:` 等方式引入每张图像。图像之间或图像与提示之间不需要换行符。

要求 Claude 描述多张图像之间的差异。
| 角色 | 内容 |
| ---- | ------------------------------------------------------------------------- |
| User | Image 1: \[图像 1\] Image 2: \[图像 2\] 这些图像有何不同？ |

<Tabs>
  <Tab title="使用 Base64">
    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()
    image1_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    image1_media_type = "image/png"
    image2_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    image2_media_type = "image/png"

    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Image 1:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image1_media_type,
                            "data": image1_data,
                        },
                    },
                    {"type": "text", "text": "Image 2:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image2_media_type,
                            "data": image2_data,
                        },
                    },
                    {"type": "text", "text": "How are these images different?"},
                ],
            }
        ],
    )
    ```
  </Tab>
  <Tab title="使用 URL">
    ```python Python
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Image 1:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                        },
                    },
                    {"type": "text", "text": "Image 2:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://upload.wikimedia.org/wikipedia/commons/b/b5/Iridescent.green.sweat.bee1.jpg",
                        },
                    },
                    {"type": "text", "text": "How are these images different?"},
                ],
            }
        ],
    )
    ```
  </Tab>
</Tabs>

</section>
<section title="示例：带系统提示的多张图像">

要求 Claude 描述多张图像之间的差异，同时为其提供一个关于如何回复的系统提示。

| 内容 |                                                                           |
| ------- | ------------------------------------------------------------------------- |
| System  | 仅用西班牙语回复。                                                  |
| User    | Image 1: \[图像 1\] Image 2: \[图像 2\] 这些图像有何不同？ |

<Tabs>
  <Tab title="使用 Base64">
    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()
    image1_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    image1_media_type = "image/png"
    image2_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
    image2_media_type = "image/png"

    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        system="Respond only in Spanish.",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Image 1:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image1_media_type,
                            "data": image1_data,
                        },
                    },
                    {"type": "text", "text": "Image 2:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": image2_media_type,
                            "data": image2_data,
                        },
                    },
                    {"type": "text", "text": "How are these images different?"},
                ],
            }
        ],
    )
    ```
  </Tab>
  <Tab title="使用 URL">
    ```python Python
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        system="Respond only in Spanish.",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Image 1:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                        },
                    },
                    {"type": "text", "text": "Image 2:"},
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://upload.wikimedia.org/wikipedia/commons/b/b5/Iridescent.green.sweat.bee1.jpg",
                        },
                    },
                    {"type": "text", "text": "How are these images different?"},
                ],
            }
        ],
    )
    ```
  </Tab>
</Tabs>

</section>
<section title="示例：两轮对话中的四张图像">

Claude 的视觉能力在混合图像和文本的多模态对话中表现出色。您可以与 Claude 进行长时间的来回交流，随时添加新图像或后续问题。这为迭代图像分析、比较或将视觉内容与其他知识相结合提供了强大的工作流程。

要求 Claude 对比两张图像，然后提出后续问题，将前两张图像与两张新图像进行比较。
| 角色 | 内容 |
| --------- | ------------------------------------------------------------------------------------ |
| User | Image 1: \[图像 1\] Image 2: \[图像 2\] 这些图像有何不同？ |
| Assistant | \[Claude 的回复\] |
| User | Image 1: \[图像 3\] Image 2: \[图像 4\] 这些图像与前两张相似吗？ |
| Assistant | \[Claude 的回复\] |

使用 API 时，将新图像作为任何标准[多轮对话](/docs/zh-CN/api/messages/create)结构的一部分，以 `user` 角色插入到 Messages 数组中。

</section>

---

## 限制 \{#limitations}

虽然 Claude 的图像理解能力处于前沿水平，但仍有一些限制需要注意：

- **人物识别**：Claude [不能用于](https://www.anthropic.com/legal/aup)识别图像中人物的姓名，并会拒绝此类请求。
- **准确性**：在解读低质量、旋转或小于 200 像素的极小图像时，Claude 可能会产生幻觉或出错。
- **空间推理**：Claude 的坐标和定位输出是近似值。请遵循[处理坐标和边界框](#working-with-coordinates-and-bounding-boxes)中的指导，并在依赖输出之前进行验证。
- **计数**：Claude 可以给出图像中物体的大致数量，但可能并不总是精确准确，尤其是在有大量小物体的情况下。
- **AI 生成的图像**：Claude 不知道图像是否由 AI 生成，如果被询问可能会给出错误答案。请勿依赖它来检测虚假或合成图像。
- **不当内容**：Claude 不会处理违反[可接受使用政策](https://www.anthropic.com/legal/aup)的不当或露骨图像。
- **医疗保健应用**：虽然 Claude 可以分析一般医学图像，但它并非设计用于解读复杂的诊断扫描，如 CT 或 MRI。Claude 的输出不应被视为专业医疗建议或诊断的替代品。

请始终仔细审查和验证 Claude 的图像解读，尤其是在高风险用例中。对于需要完美精度或敏感图像分析的任务，请勿在没有人工监督的情况下使用 Claude。

---

## 常见问题 \{#faq}

  <section title="Claude 支持哪些图像文件类型？">

    Claude 目前支持 JPEG、PNG、GIF 和 WebP 图像格式，具体为：
    - `image/jpeg`
    - `image/png`
    - `image/gif`
    - `image/webp`
  
</section>

{" "}

<section title="Claude 可以读取图像 URL 吗？">

  可以，Claude 可以通过 API 中的 URL 图像源块处理来自 URL 的图像。
  只需在 API 请求中使用 "url" 源类型而不是 "base64" 即可。
  示例：
  ```json
  {
    "type": "image",
    "source": {
      "type": "url",
      "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
    }
  }
  ```

</section>

  <section title="我可以上传的图像文件大小有限制吗？">

    是的，存在以下限制：
    - Claude API：每张图像最大 10&nbsp;MB
    - Amazon Bedrock 和 Vertex AI：每张图像最大 5&nbsp;MB
    - claude.ai：每张图像最大 10&nbsp;MB

    超过这些限制的图像会被拒绝，使用 API 时会返回错误。

    这些是每张图像的限制。总体[请求大小限制](/docs/zh-CN/api/overview#request-size-limits)（Claude API 上为 32&nbsp;MB；Amazon Bedrock 和 Vertex AI 上更低）同样适用，因此包含大量大尺寸图像的请求可能在达到单张图像上限之前就超出该限制。在 Claude API 上，请使用 [Files API](/docs/zh-CN/build-with-claude/files) 上传并通过 `file_id` 引用，以保持请求负载较小。Files API 目前在 Amazon Bedrock 或 Vertex AI 上不可用，因此在这些平台上请改为减小图像大小。

  
</section>

  <section title="一个请求中可以包含多少张图像？">

    图像限制为：
    - Messages API：每个请求最多 600 张图像（对于具有 20 万令牌上下文窗口的模型为 100 张）
    - claude.ai：每轮最多 20 张图像

    超过这些限制的请求会被拒绝并返回错误。包含大量大尺寸图像的请求也可能在达到这些限制之前失败；详情请参阅[一般限制](#general-limits)。

  
</section>

{" "}

<section title="Claude 会读取图像元数据吗？">

  不会，Claude 不会解析或接收传递给它的图像的任何元数据。

</section>

{" "}

<section title="我可以删除已上传的图像吗？">

  不可以。图像上传是临时性的，不会在 API 请求持续时间之外存储。上传的图像在处理完成后会自动删除。

</section>

{" "}

<section title="在哪里可以找到有关图像上传数据隐私的详细信息？">

  请参阅 Anthropic 隐私政策页面，了解有关如何处理上传的图像和其他数据的信息。Anthropic 不会使用上传的图像来训练模型。

</section>

  <section title="如果 Claude 的图像解读似乎有误怎么办？">

    如果 Claude 的图像解读似乎不正确：
    1. 确保图像清晰、高质量且方向正确。
    2. 尝试使用提示工程技巧来改善结果。
    3. 如果问题仍然存在，请在 claude.ai 中标记输出（点赞/点踩）或联系[支持团队](https://support.claude.com/)。

    您的反馈有助于改进 Claude！

  
</section>

  <section title="Claude 可以生成或编辑图像吗？">

    不可以，Claude 仅是一个图像理解模型。它可以解读和分析图像，但无法生成、制作、编辑、操作或创建图像。
  
</section>

---

## 深入了解视觉功能 \{#dive-deeper-into-vision}

准备好开始使用 Claude 构建图像应用了吗？以下是一些有用的资源：

- [多模态 cookbook](https://platform.claude.com/cookbook/multimodal-getting-started-with-vision)：此 cookbook 包含有关[图像入门](https://platform.claude.com/cookbook/multimodal-getting-started-with-vision)的技巧和[最佳实践技术](https://platform.claude.com/cookbook/multimodal-best-practices-for-vision)，以确保在使用图像时获得最高质量的性能。了解如何有效地使用图像提示 Claude 来执行任务，例如[解读和分析图表](https://platform.claude.com/cookbook/multimodal-reading-charts-graphs-powerpoints)或[从表单中提取内容](https://platform.claude.com/cookbook/multimodal-how-to-transcribe-text)。
- [API 参考](/docs/zh-CN/api/messages/create)：Messages API 的文档，包括[涉及图像的 API 调用](/docs/zh-CN/build-with-claude/working-with-messages#vision)示例。

如果您有任何其他问题，请联系[支持团队](https://support.claude.com/)。您还可以加入[开发者社区](https://www.anthropic.com/discord)，与其他创作者交流并获得 Anthropic 专家的帮助。