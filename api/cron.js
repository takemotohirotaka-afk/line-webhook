export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  try {
    const now = Date.now();
    const oneMinuteMs = 60 * 1000;

    // ① collecting & 未返信 を全部取る
    const inquiryRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inquiries?status=eq.collecting&replied_at=is.null&order=created_at.asc`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const allInquiries = await inquiryRes.json();

    // ② JS側で「1分経過したものだけ」に絞る
    const inquiries = allInquiries.filter((inquiry) => {
      const baseTime = inquiry.last_message_at || inquiry.created_at;
      if (!baseTime) return false;
      return now - new Date(baseTime).getTime() >= oneMinuteMs;
    });

    for (const inquiry of inquiries) {
      const inquiryId = inquiry.id;
      const userId = inquiry.user_id;

      // ③ messages を取得
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

      const userContent = [];

      userContent.push({
        type: "input_text",
        text: `以下はブランド査定のお問い合わせです。

ユーザーからのテキスト：
${texts.length ? texts.join("\n") : "（テキストなし）"}

上記テキストと商品画像をもとに、実務で送る査定文を1通だけ作成してください。`
      });

      for (const imageUrl of imageUrls) {
        userContent.push({
          type: "input_image",
          image_url: imageUrl,
        });
      }

      let replyText = `お問い合わせありがとうございます。
内容を確認いたしました。

お写真をもとに査定を進めてまいります。
追加で確認事項がある場合はご連絡させていただきます。`;

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
                      `あなたはブランド買取店の査定担当者です。
画像とユーザー文面から、実務ベースでリアルな査定コメントを作成してください。

【査定ルール】
- 中古買取相場ベースで出す
- 状態により±30%調整
- 人気ブランドは強気
- ノーブランドは弱め
- 不明な場合は無理に断定しない
- 本物・偽物は断定しない

【参考相場感】
- ルイヴィトン バッグ：2万〜8万
- シャネル バッグ：5万〜30万
- エルメス バッグ：10万〜100万以上
- カルティエ 小物：1万〜5万
- ロレックス 時計：30万〜300万
- オメガ 時計：5万〜50万

【文体ルール】
- ビジネスLINE風
- 簡潔
- 商品名＋カテゴリ＋金額レンジ
- 最後に一言添える
- 画像枚数には触れない
- そのまま送れる完成文だけを出す

【出力イメージ】
いつも大変お世話になっております。
ご連絡ありがとうございます。

ルイヴィトン　バッグ　2.5〜3.0万

ご確認の程、よろしくお願いいたします。`
                  }
                ]
              },
              {
                role: "user",
                content: userContent
              }
            ]
          }),
        });

        const aiData = await aiRes.json();

        if (aiData.output_text && aiData.output_text.trim()) {
          replyText = aiData.output_text.trim();
        } else if (aiData.error?.message) {
          replyText = `OpenAI error: ${aiData.error.message}`;
        } else {
          replyText = "OpenAI response was empty";
        }
      }

      if (replyText.length > 4500) {
        replyText = replyText.slice(0, 4500);
      }

      // ④ LINEに push
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

      // ⑤ 返信済みにする
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

    return res.status(200).json({
      ok: true,
      count: inquiries.length,
      total: allInquiries.length,
    });
  } catch (error) {
    console.error("cron error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
}
