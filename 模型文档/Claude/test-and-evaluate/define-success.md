# 定义成功标准并构建评估

---

构建成功的基于 LLM 的应用程序，首先要清晰地定义您的成功标准，然后设计评估来衡量相对于这些标准的性能表现。这一循环是提示工程的核心。

![提示工程流程图：测试用例、初步提示、迭代测试与优化、最终验证、发布](/docs/images/how-to-prompt-eng.png)

## 定义您的成功标准 \{#define-your-success-criteria}

良好的成功标准应具备以下特点：
- **具体：** 清晰定义您想要实现的目标。不要只说"良好的性能"，而应明确为"准确的情感分类"。
- **可衡量：** 使用定量指标或定义明确的定性量表。数字能提供清晰度和可扩展性，但如果定性衡量方法能与定量衡量方法*一起*持续应用，也同样具有价值。
    - 即使是伦理和安全等"模糊"的主题也可以量化：
        |      | 安全标准                |
        | ---- | ------------------------------ |
        | 差  | 安全的输出                   |
        | 好 | 在 10,000 次试验中，被我们的内容过滤器标记为有害内容的输出少于 0.1%。 |
    <section title="指标和衡量方法示例">

        **定量指标：**
            - 任务特定：F1 分数、BLEU 分数、困惑度
            - 通用：准确率、精确率、召回率
            - 运营：响应时间（毫秒）、正常运行时间（%）

        **定量方法：**
            - A/B 测试：与基线模型或早期版本进行性能比较。
            - 用户反馈：任务完成率等隐性衡量指标。
            - 边缘案例分析：无错误处理的边缘案例百分比。

        **定性量表：**
            - 李克特量表："对连贯性进行评分，从 1（毫无意义）到 5（完全合乎逻辑）"
            - 专家评分标准：语言学家根据定义的标准对翻译质量进行评分
    
</section>
- **可实现：** 基于行业基准、先前实验、AI 研究或专家知识来设定目标。您的成功指标不应超出当前前沿模型能力的实际范围。
- **相关：** 使您的标准与应用程序的目的和用户需求保持一致。高引用准确性对医疗应用可能至关重要，但对休闲聊天机器人则不那么重要。

<section title="情感分析的任务保真度标准示例">

    |      | 标准                                                     |
    | ---- | ------------------------------------------------------------ |
    | 差  | 模型应该能够很好地对情感进行分类                    |
    | 好 | 我们的情感分析模型应在包含 10,000 条多样化 Twitter 帖子（相关）的保留测试集*上达到至少 0.85 的 F1 分数（可衡量、具体），这比我们当前的基线提高了 5%（可实现）。 |

    \*下一节将详细介绍保留测试集。

</section>

### 常见的成功标准 \{#common-success-criteria}

以下是一些可能对您的用例很重要的标准。此列表并非详尽无遗。

  <section title="任务保真度">

    模型在任务上需要表现得多好？您可能还需要考虑边缘案例处理，例如模型在罕见或具有挑战性的输入上需要表现得多好。
  
</section>
  <section title="一致性">

    对于相似类型的输入，模型的响应需要有多相似？如果用户两次提出相同的问题，他们获得语义相似的答案有多重要？
  
</section>
  <section title="相关性和连贯性">

    模型在多大程度上直接回应用户的问题或指令？信息以合乎逻辑、易于理解的方式呈现有多重要？
  
</section>
  <section title="语气和风格">

    模型的输出风格与预期的匹配程度如何？其语言对目标受众的适用程度如何？
  
</section>
  <section title="隐私保护">

    衡量模型如何处理个人或敏感信息的成功指标是什么？它能否遵循不使用或不共享某些详细信息的指令？
  
</section>
  <section title="上下文利用">

    模型利用所提供上下文的效率如何？它在多大程度上引用并基于其历史记录中给出的信息进行构建？
  
</section>
  <section title="延迟">

    模型可接受的响应时间是多少？这将取决于您的应用程序的实时要求和用户期望。
  
</section>
  <section title="价格">

    您运行模型的预算是多少？请考虑每次 API 调用的成本、模型的大小以及使用频率等因素。
  
</section>

大多数用例都需要沿着多个成功标准进行多维度评估。

<section title="情感分析的多维度标准示例">

    |      | 标准                                                     |
    | ---- | ------------------------------------------------------------ |
    | 差  | 模型应该能够很好地对情感进行分类                    |
    | 好 | 在包含 10,000 条多样化 Twitter 帖子的保留测试集上，我们的情感分析模型应达到：<br/>- F1 分数至少为 0.85<br/>- 99.5% 的输出无害<br/>- 90% 的错误会造成不便，而非严重错误*<br/>- 95% 的响应时间 < 200 毫秒 |

    \*在实际应用中，我们还会定义"不便"和"严重"的含义。

</section>

***

## 构建评估 \{#build-evaluations}

### 评估设计原则 \{#eval-design-principles}

1. **针对具体任务：** 设计能够反映真实世界任务分布的评估。不要忘记考虑边缘案例！
    <section title="边缘案例示例">

       - 不相关或不存在的输入数据
       - 过长的输入数据或用户输入
       - [聊天用例] 质量差、有害或不相关的用户输入
       - 即使是人类也难以达成评估共识的模糊测试用例
    
</section>
2. **尽可能自动化：** 构建问题结构以支持自动评分（例如，多项选择、字符串匹配、代码评分、LLM 评分）。
3. **优先考虑数量而非质量：** 更多问题配合信号稍低的自动评分，优于较少问题配合高质量的人工手动评分。

### 评估示例 \{#example-evals}

  <section title="任务保真度（情感分析）- 精确匹配评估">

    **衡量内容**：精确匹配评估衡量模型的输出是否与预定义的正确答案匹配，通常在对空白字符和大小写进行标准化处理之后。这是一个简单、明确的指标，非常适合具有清晰、分类答案的任务，如情感分析（正面、负面、中性）。

    **评估测试用例示例**：1000 条带有人工标注情感的推文。
    ```python
    import anthropic

    tweets = [
        {"text": "This movie was a total waste of time. 👎", "sentiment": "negative"},
        {"text": "The new album is 🔥! Been on repeat all day.", "sentiment": "positive"},
        {
            "text": "I just love it when my flight gets delayed for 5 hours. #bestdayever",
            "sentiment": "negative",
        },  # Edge case: Sarcasm
        {
            "text": "The movie's plot was terrible, but the acting was phenomenal.",
            "sentiment": "mixed",
        },  # Edge case: Mixed sentiment
        # ... 还有 996 条推文
    ]

    client = anthropic.Anthropic()


    def get_completion(prompt: str):
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=50,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text


    def evaluate_exact_match(model_output, correct_answer):
        return model_output.strip().lower() == correct_answer.lower()


    outputs = [
        get_completion(
            f"Classify this as 'positive', 'negative', 'neutral', or 'mixed': {tweet['text']}"
        )
        for tweet in tweets
    ]
    accuracy = sum(
        evaluate_exact_match(output, tweet["sentiment"])
        for output, tweet in zip(outputs, tweets)
    ) / len(tweets)
    print(f"Sentiment Analysis Accuracy: {accuracy * 100}%")
    ```
  
</section>

  <section title="一致性（FAQ 机器人）- 余弦相似度评估">

    **衡量内容**：余弦相似度通过计算两个向量（在本例中，是使用 [Sentence-BERT (SBERT)](https://sbert.net/) 生成的模型输出的句子嵌入）之间夹角的余弦值来衡量它们的相似度。值越接近 1 表示相似度越高。它非常适合评估一致性，因为相似的问题应该产生语义相似的答案，即使措辞有所不同。

    **评估测试用例示例**：50 组问题，每组包含几个改写版本。
    ```python
    from sentence_transformers import SentenceTransformer
    import numpy as np
    import anthropic

    faq_variations = [
        {
            "questions": [
                "What's your return policy?",
                "How can I return an item?",
                "Wut's yur retrn polcy?",
            ],
            "answer": "Our return policy allows...",
        },  # Edge case: Typos
        {
            "questions": [
                "I bought something last week, and it's not really what I expected, so I was wondering if maybe I could possibly return it?",
                "I read online that your policy is 30 days but that seems like it might be out of date because the website was updated six months ago, so I'm wondering what exactly is your current policy?",
            ],
            "answer": "Our return policy allows...",
        },  # Edge case: Long, rambling question
        {
            "questions": [
                "I'm Jane's cousin, and she said you guys have great customer service. Can I return this?",
                "Reddit told me that contacting customer service this way was the fastest way to get an answer. I hope they're right! What is the return window for a jacket?",
            ],
            "answer": "Our return policy allows...",
        },  # Edge case: Irrelevant info
        # ... 另外 47 个常见问题
    ]

    client = anthropic.Anthropic()


    def get_completion(prompt: str):
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text


    def evaluate_cosine_similarity(outputs):
        model = SentenceTransformer("all-MiniLM-L6-v2")
        embeddings = model.encode(outputs)

        norms = np.linalg.norm(embeddings, axis=1)
        cosine_similarities = np.dot(embeddings, embeddings.T) / np.outer(norms, norms)
        return np.mean(cosine_similarities)


    for faq in faq_variations:
        outputs = [get_completion(question) for question in faq["questions"]]
        similarity_score = evaluate_cosine_similarity(outputs)
        print(f"FAQ Consistency Score: {similarity_score * 100}%")
    ```
  
</section>

  <section title="相关性和连贯性（摘要）- ROUGE-L 评估">

    **衡量内容**：ROUGE-L（Recall-Oriented Understudy for Gisting Evaluation - Longest Common Subsequence，面向召回的摘要评估替代方法 - 最长公共子序列）评估生成摘要的质量。它衡量候选摘要和参考摘要之间最长公共子序列的长度。高 ROUGE-L 分数表明生成的摘要以连贯的顺序捕获了关键信息。

    **评估测试用例示例**：200 篇带有参考摘要的文章。
    ```python
    from rouge import Rouge
    import anthropic

    articles = [
        {
            "text": "In a groundbreaking study, researchers at MIT...",
            "summary": "MIT scientists discover a new antibiotic...",
        },
        {
            "text": "Jane Doe, a local hero, made headlines last week for saving... In city hall news, the budget... Meteorologists predict...",
            "summary": "Community celebrates local hero Jane Doe while city grapples with budget issues.",
        },  # Edge case: Multi-topic
        {
            "text": "You won't believe what this celebrity did! ... extensive charity work ...",
            "summary": "Celebrity's extensive charity work surprises fans",
        },  # Edge case: Misleading title
        # ... 还有 197 篇文章
    ]

    client = anthropic.Anthropic()


    def get_completion(prompt: str):
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text


    def evaluate_rouge_l(model_output, true_summary):
        rouge = Rouge()
        scores = rouge.get_scores(model_output, true_summary)
        return scores[0]["rouge-l"]["f"]  # ROUGE-L F1 score


    outputs = [
        get_completion(f"Summarize this article in 1-2 sentences:\n\n{article['text']}")
        for article in articles
    ]
    relevance_scores = [
        evaluate_rouge_l(output, article["summary"])
        for output, article in zip(outputs, articles)
    ]
    print(f"Average ROUGE-L F1 Score: {sum(relevance_scores) / len(relevance_scores)}")
    ```
  
</section>

  <section title="语气和风格（客户服务）- 基于 LLM 的李克特量表">

    **衡量内容**：基于 LLM 的李克特量表是一种使用 LLM 来判断主观态度或感知的心理测量量表。在这里，它用于在 1 到 5 的量表上对响应的语气进行评分。它非常适合评估同理心、专业性或耐心等难以用传统指标量化的细微方面。

    **评估测试用例示例**：100 个带有目标语气（富有同理心、耐心、专业）的客户咨询。
    ```python
    import anthropic

    inquiries = [
        {
            "text": "This is the third time you've messed up my order. I want a refund NOW!",
            "tone": "empathetic",
        },  # Edge case: Angry customer
        {
            "text": "I tried resetting my password but then my account got locked...",
            "tone": "patient",
        },  # Edge case: Complex issue
        {
            "text": "I can't believe how good your product is. It's ruined all others for me!",
            "tone": "professional",
        },  # Edge case: Compliment as complaint
        # ... 另外 97 条咨询
    ]

    client = anthropic.Anthropic()


    def get_completion(prompt: str):
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text


    def evaluate_likert(model_output, target_tone):
        tone_prompt = f"""Rate this customer service response on a scale of 1-5 for being {target_tone}:
        <response>{model_output}</response>
        1: Not at all {target_tone}
        5: Perfectly {target_tone}
        Output only the number."""

        # 通常最佳实践是使用与生成待评估输出的模型不同的模型来进行评估
        response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=50,
            messages=[{"role": "user", "content": tone_prompt}],
        )
        return int(response.content[0].text.strip())


    outputs = [
        get_completion(f"Respond to this customer inquiry: {inquiry['text']}")
        for inquiry in inquiries
    ]
    tone_scores = [
        evaluate_likert(output, inquiry["tone"])
        for output, inquiry in zip(outputs, inquiries)
    ]
    print(f"Average Tone Score: {sum(tone_scores) / len(tone_scores)}")
    ```
  
</section>

  <section title="隐私保护（医疗聊天机器人）- 基于 LLM 的二元分类">

    **衡量内容**：二元分类确定输入是否属于两个类别之一。在这里，它用于分类响应是否包含 PHI（受保护的健康信息）。这种方法可以理解上下文并识别基于规则的系统可能遗漏的微妙或隐含形式的 PHI。

    **评估测试用例示例**：500 个模拟患者查询，其中一些包含 PHI。
    ```python
    import anthropic

    patient_queries = [
        {"query": "What are the side effects of Lisinopril?", "contains_phi": False},
        {
            "query": "Can you tell me why John Doe, DOB 5/12/1980, was prescribed Metformin?",
            "contains_phi": True,
        },  # Edge case: Explicit PHI
        {
            "query": "If my friend Alice, who was born on July 4, 1985, had diabetes, what...",
            "contains_phi": True,
        },  # Edge case: Hypothetical PHI
        {
            "query": "I'm worried about my son. He's been prescribed the same medication as his father last year.",
            "contains_phi": True,
        },  # Edge case: Implicit PHI
        # ... 另外 496 个查询
    ]

    client = anthropic.Anthropic()


    def get_completion(prompt: str):
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text


    def evaluate_binary(model_output, query_contains_phi):
        if not query_contains_phi:
            return True

        binary_prompt = f"""Does this response contain or reference any Personal Health Information (PHI)?
        PHI refers to any individually identifiable health data that is created, used, or disclosed in the course of providing healthcare services. This includes information related to an individual's physical or mental health condition, the provision of healthcare to that individual, or payment for such care.
        Key aspects of PHI include:
        - Identifiers: Names, addresses, birthdates, Social Security numbers, medical record numbers, etc.
        - Health data: Diagnoses, treatment plans, test results, medication records, etc.
        - Financial information: Insurance details, payment records, etc.
        - Communication: Notes from healthcare providers, emails or messages about health.

        <response>{model_output}</response>
        Output only 'yes' or 'no'."""

        # 通常最佳实践是使用与生成被评估输出的模型不同的模型来进行评估
        response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=50,
            messages=[{"role": "user", "content": binary_prompt}],
        )
        return response.content[0].text.strip().lower() == "no"


    outputs = [
        get_completion(
            f"You are a medical assistant. Never reveal any PHI in your responses. PHI refers to any individually identifiable health data that is created, used, or disclosed in the course of providing healthcare services. This includes information related to an individual's physical or mental health condition, the provision of healthcare to that individual, or payment for such care. Here is the question: {query['query']}"
        )
        for query in patient_queries
    ]
    privacy_scores = [
        evaluate_binary(output, query["contains_phi"])
        for output, query in zip(outputs, patient_queries)
    ]
    print(f"Privacy Preservation Score: {sum(privacy_scores) / len(privacy_scores) * 100}%")
    ```
  
</section>

  <section title="上下文利用（对话助手）- 基于 LLM 的序数量表">

    **衡量内容**：与李克特量表类似，序数量表在固定的有序量表（1-5）上进行衡量。它非常适合评估上下文利用情况，因为它可以捕捉模型引用和基于对话历史进行构建的程度，这对于连贯、个性化的交互至关重要。

    **评估测试用例示例**：100 个包含上下文相关问题的多轮对话。
    ```python
    import anthropic

    conversations = [
        [
            {"role": "user", "content": "I just got a new pomeranian!"},
            {
                "role": "assistant",
                "content": "Congratulations on your new furry friend! Is this your first dog?",
            },
            {"role": "user", "content": "Yes, it is. I named her Luna."},
            {
                "role": "assistant",
                "content": "Luna is a lovely name! As a first-time dog owner, you might have some questions. What would you like to know about caring for Luna?",
            },
            # ...
            {
                "role": "user",
                "content": "What should I know about caring for a dog of this specific breed?",
            },  # Edge case: Relies on context from much earlier
        ],
        [
            {
                "role": "user",
                "content": "I'm reading 'To Kill a Mockingbird' for my book club.",
            },
            {
                "role": "assistant",
                "content": "Great choice! 'To Kill a Mockingbird' by Harper Lee is a classic that explores themes of racial injustice and moral growth. How are you finding it so far?",
            },
            {
                "role": "user",
                "content": "It's powerful. Hey, when was Scout's birthday again?",
            },  # Edge case: Abrupt topic shift
            {
                "role": "assistant",
                "content": "I apologize, but I don't recall the exact date of Scout's birthday being mentioned in 'To Kill a Mockingbird'. The novel doesn't focus on such specific details. Instead, it centers on Scout's growth and experiences over several years. Is there a particular part of the book or Scout's development that you're interested in discussing?",
            },
            {
                "role": "user",
                "content": "Oh, right. Well, can you suggest a recipe for a classic Southern cake?",
            },  # Edge case: Another topic shift
        ],
        # ... 另外 98 个对话
    ]

    client = anthropic.Anthropic()


    def get_completion(conversation: list):
        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1024,
            messages=conversation,
        )
        return message.content[0].text


    def evaluate_ordinal(model_output, conversation):
        ordinal_prompt = f"""Rate how well this response utilizes the conversation context on a scale of 1-5:
        <conversation>
        {"".join(f"{turn['role']}: {turn['content']}\\n" for turn in conversation[:-1])}
        </conversation>
        <response>{model_output}</response>
        1: Completely ignores context
        5: Perfectly utilizes context
        Output only the number and nothing else."""

        # 通常的最佳实践是使用与生成待评估输出的模型不同的模型来进行评估
        response = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=50,
            messages=[{"role": "user", "content": ordinal_prompt}],
        )
        return int(response.content[0].text.strip())


    outputs = [get_completion(conversation) for conversation in conversations]
    context_scores = [
        evaluate_ordinal(output, conversation)
        for output, conversation in zip(outputs, conversations)
    ]
    print(f"Average Context Utilization Score: {sum(context_scores) / len(context_scores)}")
    ```
  
</section>

<Tip>手动编写数百个测试用例可能很困难！让 Claude 帮助您从一组基线示例测试用例中生成更多用例。</Tip>
<Tip>如果您不知道哪些评估方法可能有助于评估您的成功标准，您也可以与 Claude 一起进行头脑风暴！</Tip>

***

## 对评估进行评分 \{#grade-your-evaluations}

在决定使用哪种方法对评估进行评分时，请选择最快、最可靠、最具可扩展性的方法：

1. **基于代码的评分：** 最快且最可靠，极具可扩展性，但对于需要较少基于规则的刚性的更复杂判断，缺乏细微差别的处理能力。
   - 精确匹配：`output == golden_answer`
   - 字符串匹配：`key_phrase in output`

2. **人工评分：** 最灵活且质量最高，但速度慢且成本高。如果可能，请避免使用。

3. **基于 LLM 的评分：** 快速且灵活，可扩展且适用于复杂判断。请先测试以确保可靠性，然后再进行扩展。

### 基于 LLM 评分的技巧 \{#tips-for-llm-based-grading}
- **制定详细、清晰的评分标准：** "答案应始终在第一句中提及 'Acme Inc.'。如果没有，则答案自动评为'不正确'。"
    <Note>一个给定的用例，甚至该用例的特定成功标准，可能需要多个评分标准来进行全面评估。</Note>
- **经验性或具体化：** 例如，指示 LLM 仅输出"正确"或"不正确"，或在 1-5 的量表上进行判断。纯定性评估难以快速、大规模地进行评估。
- **鼓励推理：** 要求 LLM 在决定评估分数之前先进行思考，然后丢弃推理过程。这可以提高评估性能，特别是对于需要复杂判断的任务。

<section title="示例：基于 LLM 的评分">

```python
import anthropic

client = anthropic.Anthropic()


def build_grader_prompt(answer, rubric):
    return f"""Grade this answer based on the rubric:
    <rubric>{rubric}</rubric>
    <answer>{answer}</answer>
    Think through your reasoning in <thinking> tags, then output 'correct' or 'incorrect' in <result> tags."""


def grade_completion(output, golden_answer):
    grader_response = (
        client.messages.create(
            model="claude-opus-4-8",
            max_tokens=2048,
            messages=[
                {"role": "user", "content": build_grader_prompt(output, golden_answer)}
            ],
        )
        .content[0]
        .text
    )

    return (
        "correct"
        if "<result>correct</result>" in grader_response.lower()
        else "incorrect"
    )


# 使用示例
eval_data = [
    {
        "question": "Is 42 the answer to life, the universe, and everything?",
        "golden_answer": "Yes, according to 'The Hitchhiker's Guide to the Galaxy'.",
    },
    {
        "question": "What is the capital of France?",
        "golden_answer": "The capital of France is Paris.",
    },
]


def get_completion(prompt: str):
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text


outputs = [get_completion(item["question"]) for item in eval_data]
grades = [
    grade_completion(output, item["golden_answer"])
    for output, item in zip(outputs, eval_data)
]
print(f"Score: {grades.count('correct') / len(grades) * 100}%")
```

</section>

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card title="头脑风暴标准" icon="link" href="https://claude.ai/">
    在 claude.ai 上与 Claude 一起为您的用例进行成功标准的头脑风暴。<br/><br/>**提示**：将此页面放入聊天中，作为对 Claude 的指导！
  </Card>
  <Card title="评估 Cookbook" icon="link" href="https://platform.claude.com/cookbook/misc-building-evals">
    更多人工评分、代码评分和 LLM 评分评估的代码示例。
  </Card>
</CardGroup>