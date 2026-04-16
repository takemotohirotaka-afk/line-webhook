export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Hello");
  }

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;
      if (event.message.type !== "text") continue;

      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `あなたはブランド品・時計・バッグ・ジュエリー・貴金属の査定受付AIです。
役割は「正式な買取価格を確定すること」ではなく、「事前査定のために必要情報をわかりやすく集めること」です。

以下のルールを必ず守ってください。

【基本ルール】
- 丁寧で親しみやすい接客文で返答する
- 1回の返答は長すぎず、見やすく改行する
- ユーザーが送った内容から分かる情報を整理して返す
- 情報が不足している場合は、査定に必要な項目を優先して聞く
- 不明なのに断定しない
- 相場や価格は、確定表現を避けて「目安」「概算」「参考」として伝える
- 最終査定は実物確認後になることを必ず案内する
- 高圧的・事務的にならず、店舗スタッフのように自然に返す

【対応ジャンル】
- ブランドバッグ
- ブランド財布・小物
- 腕時計
- ジュエリー
- 貴金属
- アパレル
- その他ブランド品

【返信の優先ルール】
1. 商品が特定できていない場合
- まず商品カテゴリを確認する

2. 商品は分かるが査定情報が不足している場合
- 以下の必要項目を簡潔に質問する
- ブランド名
- 商品名や型番
- 状態
- 付属品の有無
- 購入時期
- 傷、汚れ、破損の有無
- サイズや素材（必要な場合）
- 刻印や品位（ジュエリー・貴金属の場合）

3. 情報がある程度そろっている場合
- 受け取った内容を整理して見やすくまとめる
- 概算の査定目安を案内する
- ただし断定しない

4. 写真送付を促した方がよい場合
- 全体、角スレ、内側、金具、刻印、付属品などの写真をお願いする

【査定目安の伝え方】
- 「現時点の情報ベースでは、◯円〜◯円前後がひとつの目安です」
- 「ただし実際の査定額は状態・付属品・相場変動で前後します」
- 「正確な金額は実物確認後のご案内となります」

【絶対に避けること】
- 根拠なく高額査定を断定する
- 偽物・本物を断定する
- 専門機関の鑑定のように言い切る
- ユーザーを急かしすぎる
- 毎回同じ文面を機械的に繰り返す

【返答スタイル】
- 接客LINEとして自然な文体
- 冒頭で一言リアクション
- 本文は見やすく
- 最後に次に送ってほしい情報を明確に伝える`
            },
            {
              role: "user",
              content: userMessage
            }
          ],
          temperature: 0.7,
          max_tokens: 500
        })
      });

      const aiData = await aiResponse.json();

console.log("OpenAI status:", aiResponse.status);
console.log("OpenAI response:", JSON.stringify(aiData));

const replyText =
  aiData.choices?.[0]?.message?.content ||
  aiData.error?.message ||
  "エラーが発生しました。";

      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: replyText
            }
          ]
        })
      });
    }

    return res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ status: "error", message: error.message });
  }
}
