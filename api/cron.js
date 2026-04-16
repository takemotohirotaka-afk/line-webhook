export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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

      const images = messages
        .filter((m) => m.type === "image" && m.image_url)
        .map((m) => m.image_url);

      // ③ 返信文を作る（今は仮）
      let replyText = "お問い合わせありがとうございます。\n内容を確認いたしました。";

      if (texts.length > 0) {
        replyText += `\n\nテキスト内容:\n${texts.join("\n")}`;
      }

      replyText += `\n\n画像枚数: ${images.length}枚`;

      if (images.length > 0) {
        replyText += `\nお写真をもとに順次確認いたします。`;
      }

      replyText += `\n\n担当よりご案内いたします。`;

      // LINEの文字数制限対策
      if (replyText.length > 4500) {
        replyText = replyText.slice(0, 4500);
      }

      // ④ LINEに push 送信
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

      // ⑤ 二重送信防止
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
