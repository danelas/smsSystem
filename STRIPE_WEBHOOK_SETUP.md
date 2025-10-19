# Stripe Webhook Setup Guide - Live Mode

## 🚨 Current Issue

**Payment completes successfully BUT no SMS is sent with contact details.**

### Why?
Stripe isn't sending webhook events to your server after payment completion. The webhook endpoint needs to be configured in Stripe Dashboard.

---

## ✅ Step-by-Step Setup

### **Step 1: Add Webhook Endpoint in Stripe Dashboard**

1. **Go to Stripe Dashboard (LIVE MODE):**
   ```
   https://dashboard.stripe.com/webhooks
   ```
   
   ⚠️ **IMPORTANT:** Make sure you're in **LIVE MODE** (not test mode)

2. **Click "Add endpoint" button**

3. **Enter Endpoint URL:**
   ```
   https://smssystem.onrender.com/webhooks/stripe
   ```

4. **Select Events to Listen:**
   - Click "Select events"
   - Search for and select: `checkout.session.completed`
   - Click "Add events"

5. **Click "Add endpoint"**

---

### **Step 2: Get the Signing Secret**

After creating the endpoint:

1. **Click on the newly created endpoint** in the list

2. **Find "Signing secret" section**

3. **Click "Reveal"** to show the secret

4. **Copy the secret** - it looks like:
   ```
   whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

---

### **Step 3: Update Render Environment Variable**

1. **Go to Render Dashboard:**
   ```
   https://dashboard.render.com/
   ```

2. **Select your service:** `gold-touch-leads`

3. **Go to "Environment" tab**

4. **Find `STRIPE_WEBHOOK_SECRET`**

5. **Update the value** with the signing secret you just copied from Stripe

6. **Click "Save Changes"**

7. **Render will automatically redeploy** with the new secret

---

### **Step 4: Test the Webhook**

#### **Option A: Test from Stripe Dashboard**

1. In Stripe Dashboard, go to your webhook endpoint

2. Click "Send test webhook"

3. Select event type: `checkout.session.completed`

4. Click "Send test webhook"

5. **Check Render logs** - you should see:
   ```
   Stripe webhook handler - crypto available: object
   ✅ Webhook signature verified successfully
   🎉 PAYMENT COMPLETED! Processing checkout completion...
   ```

#### **Option B: Make a Real Test Payment**

1. Create a new lead (submit form)

2. Reply "Y" to the SMS

3. Click the payment link

4. Complete payment with test card:
   ```
   Card: 4242 4242 4242 4242
   Expiry: Any future date
   CVC: Any 3 digits
   ZIP: Any 5 digits
   ```

5. **Check Render logs** for webhook processing

6. **Check SMS** - should receive contact details

---

## 🔍 Verification Checklist

### **Before Testing:**

- [ ] Webhook endpoint added in Stripe Dashboard (LIVE mode)
- [ ] Event `checkout.session.completed` is selected
- [ ] Signing secret copied from Stripe
- [ ] `STRIPE_WEBHOOK_SECRET` updated in Render
- [ ] Service redeployed with new secret

### **Test Endpoint Connectivity:**

Visit in browser:
```
https://smssystem.onrender.com/webhooks/stripe
```

Should return:
```json
{
  "message": "Stripe webhook endpoint is reachable",
  "status": "ready"
}
```

### **Check Diagnostics:**

Visit:
```
https://smssystem.onrender.com/stripe-diagnostics
```

Should show:
```json
{
  "status": "OK",
  "stripe_info": {
    "webhook_secret_configured": true,
    "webhook_secret_prefix": "whsec_..."
  }
}
```

---

## 🐛 Troubleshooting

### **Issue: Webhook returns 400 error**

**Check:**
1. Is the signing secret correct?
2. Is it from LIVE mode (not test mode)?
3. Does it start with `whsec_`?

**Fix:**
- Copy the signing secret again from Stripe Dashboard
- Make sure you're in LIVE mode
- Update Render environment variable
- Redeploy

---

### **Issue: Webhook returns 200 but no SMS sent**

**Check Render logs for:**
```
🎉 PAYMENT COMPLETED! Processing checkout completion...
Found unlock record: {...}
Successfully revealed lead details to provider...
```

**If you see errors:**
- Check database connection
- Check SMS service credentials
- Check provider phone number

---

### **Issue: No webhook received at all**

**Possible causes:**
1. Webhook endpoint not configured in Stripe
2. Wrong URL in Stripe Dashboard
3. Firewall blocking Stripe's IP addresses

**Fix:**
1. Verify webhook URL in Stripe Dashboard
2. Test endpoint connectivity (visit in browser)
3. Check Render logs for any incoming requests

---

## 📊 Expected Flow After Setup

### **1. User Submits Form**
```
✅ Lead created in database
✅ Teaser SMS sent to provider
```

### **2. Provider Replies "Y"**
```
✅ Unlock created
✅ Payment link SMS sent
```

### **3. Provider Clicks Link & Pays**
```
✅ Stripe processes payment
✅ Stripe sends webhook to your server
✅ Your server receives webhook
✅ Webhook signature verified
✅ Payment marked as complete
✅ SMS sent with contact details
```

### **4. Provider Receives Contact Info**
```
SMS: "🎉 Payment confirmed! Contact: John Doe
Phone: +1234567890
Email: john@example.com
Service: Massage
Location: Miami, FL"
```

---

## 🔐 Security Notes

### **Webhook Secret:**
- ⚠️ Keep it secret - never commit to git
- ⚠️ Different for test mode vs live mode
- ⚠️ Regenerate if compromised

### **Signature Verification:**
- ✅ Always verify webhook signatures
- ✅ Use raw request body (already implemented)
- ✅ Check signature before processing

---

## 📝 Common Mistakes

### ❌ **Wrong Mode**
Using test mode signing secret with live mode payments (or vice versa)

**Fix:** Make sure both Stripe keys and webhook secret are from the same mode

### ❌ **Wrong URL**
Typo in webhook URL or using localhost

**Fix:** Use exact URL: `https://smssystem.onrender.com/webhooks/stripe`

### ❌ **Not Selecting Events**
Creating webhook endpoint but not selecting any events

**Fix:** Must select `checkout.session.completed` event

### ❌ **Old Secret**
Using old signing secret after regenerating

**Fix:** Always use the current signing secret from Stripe Dashboard

---

## ✅ Success Indicators

### **In Stripe Dashboard:**
- Webhook endpoint shows "Enabled"
- Recent webhook attempts show 200 status
- No failed deliveries

### **In Render Logs:**
- See "Stripe webhook handler" messages
- See "✅ Webhook signature verified successfully"
- See "🎉 PAYMENT COMPLETED!"
- See "Successfully revealed lead details"

### **Provider Experience:**
- Receives teaser SMS
- Receives payment link SMS
- Completes payment
- **Receives contact details SMS** ← This is the goal!

---

## 🆘 Still Not Working?

1. **Check Stripe Dashboard → Webhooks → Your endpoint → "Recent deliveries"**
   - Are webhooks being sent?
   - What's the response status?
   - Any error messages?

2. **Check Render Logs**
   - Search for "stripe"
   - Look for error messages
   - Check if webhook is received

3. **Test with Stripe CLI (optional):**
   ```bash
   stripe listen --forward-to https://smssystem.onrender.com/webhooks/stripe
   stripe trigger checkout.session.completed
   ```

---

**Last Updated:** 2025-10-19  
**Status:** ⚠️ Awaiting webhook configuration in Stripe Dashboard
