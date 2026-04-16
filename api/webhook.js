export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("Hello");
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    const events = req.body.events || [];

    for (const event of events) {
      if (event.type !== "message") continue;

      const userId = event.source.userId;
      const replyToken = event.replyToken;

      // ① inquiry取得 or 作成
      let inquiryRes = await fetch(
        `${SUPABASE_URL}/rest/v1/inquiries?user_id=eq.${userId}&status=eq.collecting`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      let inquiries = await inquiryRes.json();
      let inquiryId;

      if (inquiries.length === 0) {
        // 新規作成
        let createRes = await fetch(`${SUPABASE_URL}/rest/v1/inquiries`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            user_id: userId,
            status: "collecting",
          }),
        });

        let newInquiry = await createRes.json();
        inquiryId = newInquiry[0].id;
      } else {
        inquiryId = inquiries[0].id;
      }

      // ② メッセージ保存
      let messageData = {
        inquiry_id: inquiryId,
        type: event.message.type,
        text: event.message.text || null,
        image_url: null,
      };

      await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify(messageData),
      });

      // ③ とりあえず返信
      await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          replyToken: replyToken,
          messages: [
            {
              type: "text",
              text: "内容を受け付けました。",
            },
          ],
        }),
      });
    }

    return res.status(200).json({ status: "OK" });
  } catch (error) {
    console.error(error);
    return res.status(200).json({ status: "error", message: error.message });
  }
}
