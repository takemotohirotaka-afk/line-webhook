export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  try {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

    // ① 1分経過 & 未返信 の inquiry を取得
    const inquiryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inquiries?status=eq.collecting&last_message_at=lte.${encodeURIComponent(oneMinuteAgo)}&replied_at=is.null&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const inquiries = await inquiryRes.json();

    for (const inquiry of inquiries) {
      const inquiryId = inquiry.id;
      const userId = inquiry.user_id;

      // ② inquiry に紐づく messages を取得
      const msgRes = await fetch(
        `${SUPABASE_URL}/rest/v1/messages?inquiry_id=eq.${inquiryId}&order=created_at.asc`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      const messages = await msgRes.json();

      const texts = messages
        .filter((m) => m.type === "text" && m.text)
        .map((m) => m.text);

      const imageUrls = messages
        .filter((m) => m.type === "image" && m.image_url)
        .map((m) => m.image_url);

      // ③ GPTに渡す入力を作る
      const userContent = [];

      userContent.push({
        type: "input_text",
        text: `以下の商品画像の査定をお願いします。

実務ベースでリアルな査定をしてください。

【査定ルール】
・中古買取相場ベースで出す
・状態により±30%調整
・人気ブランドは強気
・ノーブランドは弱め

【参考相場感】
・ルイヴィトン バッグ：2万〜8万
・シャネル バッグ：5万〜30万
・エルメス バッグ：10万〜100万以上
・カルティエ 小物：1万〜5万
・ロレックス 時計：30万〜300万
・オメガ 時計：5万〜50万

【出力ルール】
・ビジネスLINE風
・簡潔
・商品名＋カテゴリ＋金額レンジ
・最後に一言

自然な査定文を作成してください。`
});

      for (const imageUrl of imageUrls) {
        userContent.push({
          type: "input_image",
          image_url: imageUrl,
        });
      }

      // ④ OpenAIに送信
      let replyText = "お問い合わせありがとうございます。\n内容を確認いたしました。\n\nお写真をもとに査定を進めてまいります。\n追加で確認事項がある場合はご連絡させていただきます。";

      if (OPENAI_API_KEY) {
        const aiRes = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            input: [
              {
                role: "system",
                content: [
                  {
                    type: "input_text",
                    text:
                      `あなたはブランド品・時計・バッグ・ジュエリー・貴金属のLINE査定受付担当です。\n` +
                      `役割は、画像とユーザー文面から分かる範囲で一次査定コメントを作ることです。\n\n` +
                      `必ず守るルール:\n` +
                      `- LINE向けの自然で短すぎない丁寧文\n` +
                      `- 本物・偽物は断定しない\n` +
                      `- 金額を出す場合は「参考」「目安」「前後」で表現する\n` +
                      `- 画像で判断できる範囲は活用する\n` +
                      `- 足りない情報があれば最後に最小限だけ聞く\n` +
                      `- 画像枚数には触れない\n` +
                      `- 返答はそのまま送れる完成文だけを出す\n\n` +
                      `理想の文体:\n` +
                      `お問い合わせありがとうございます。\n内容を確認いたしました。\n\n` +
                      `お写真をもとに査定を進めてまいります。\n追加で確認事項がある場合はご連絡させていただきます。`
                  }
                ]
              },
              {
                role: "user",
                content: userContent
              }
            ],
          }),
        });

        const aiData = await aiRes.json();

        if (aiData.output_text && aiData.output_text.trim()) {
          replyText = aiData.output_text.trim();
        } else if (aiData.error?.message) {
          replyText =
            "お問い合わせありがとうございます。\n内容を確認いたしました。\n\nお写真をもとに査定を進めてまいります。\n追加で確認事項がある場合はご連絡させていただきます。";
        }
      }

      // LINE文字数対策
      if (replyText.length > 4500) {
        replyText = replyText.slice(0, 4500);
      }

      // ⑤ LINEに push 送信
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [
            {
              type: "text",
              text: replyText,
            },
          ],
        }),
      });

      // ⑥ 二重送信防止
      await fetch(`${SUPABASE_URL}/rest/v1/inquiries?id=eq.${inquiryId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          replied_at: new Date().toISOString(),
          reply_text: replyText,
        }),
      });
    }

    return res.status(200).json({ ok: true, count: inquiries.length });
  } catch (error) {
    console.error("cron error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
