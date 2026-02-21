## Functional Requirements

### **Must-Have**

* Users can create a personal account/profile.

* Users can upload, replace, and delete their own profile images (face and full-body) and their height and weight.

* Users can upload and delete images of clothing items.

* The system analyzes uploaded clothing images and extracts clothing features, generating cloth's name, category (tops, pants, shoes, etc.), tag (fabric, color, long/short), and description.

* Users can modify the features (including name, category, tag, and description) for their clothes.

* Users can communicate their clothing needs to the agent and ask for clothing recommendations.

* Users can vote some outfits from recommendation results as their preferences.

* Users can permanently delete their accounts.

* The system stores extracted clothing features (category, tag, description) in a per-user private database which can be used by users and LLMs to filter and search.

* The system can invoke weather query tool to get the weather condition for making the recommendation.&#x20;

* The system generates realistic images showing how each recommended outfit would look on the user’s body (virtual try-on visualization). The image must basicly match the user's body shape and appearance.

* The system recommends three outfits per request based on the user’s existing cloud closet. Each recommended outfit must include the new item plus compatible items from the user’s cloud closet.

* The system can summeriuze user's preferences to give more personalized recommendations in future sessions.

* Users can upload an online product image and request a visual try-on of that item on themselves. The system can recommand possible combinations with the user’s existing cloud closet. This function is triggered by a user request, and the system will provide three recommendations based on the categories and tags of these clothes.

### Nice-to-Have

* Users can select clothes from the cloud closet to have the agent make recommendations instead of relying on all the clothes in the entire cloud closet.

* The system can recognize and recommend accessories (jewjlry,hats,bags).This stays nice-to-have because accessory-heavy image parsing adds extra visual attributes and increases inference time,which may slow down the user experience.

* The system will automatically detect whether user-uploaded images contain pornography or nudity, violence, gore, offensive content and refuse to upload.

### Won't Have

* Build a social network for users to post content.

* Establish the workflow for end-to-end ecommerce including purchase, payment, order tracking, and returns.

* Give any advice on health care such as weight loss and body shaping based on the uploaded body photos

## Non-Functional Requirements

### **Performance**

* Text recommendation result will return within 45 seconds.

* Try-on image generation completes within an acceptable waiting window (target: within \~90 seconds per request, mainly decided by LLM).

* Cloud closet browsing/search stays responsive (target: within \~2 seconds for common operations).

### **Security**

* User's username, gmail will be encrypted by SHA256, and uploaded images need to be encrypted by AES. Once the user logs in, the system will generate a JWT as a credential for request validation.

* User accounts and sessions are handled with the Google portal.

* User photos and cloud closet assets are protected in database and transmission.

* API keys will not be exposed to users and will be stored securely.

* We will have age verification and explicit consent gating before any face/body upload or try-on

### **Privacy**

* Users have full control of their data including deleting the uploaded information and their accounts.

* Only the data needed for cloud closet and recommendations will be stored. It includes account and login information(via Google OAuth),  profile information (height, weight, and user-uploaded face/full-body photos), cloud closet content (uploaded clothing images and the extracted/editable clothing attributes , e.g., category, tags, description), user's feedback on recommended outfits, virtual try-on data(user-provided product images and generated try-on results).

* Our AI providers (Google Gemini API Paid Tier and Cloud Vision API) state that user content, including uploaded images, is not used to train or improve their models (specific links are in the appendix).

### **Usability**

* Users can complete account sign-in and reach the chat screen in ≤ 3 user actions, then they can chat and interact with agent.

* The interaction page can be accessed on both desktop and mobile.

## Technology Stack

* **Frontend**: TypeScript, React

* **Backend**: TypeScript, Vercel

* **Database**: MongoDB

* **Image Storage:&#x20;**&#x43;loudflare R2

* **Auth:** Google OAuth 2.0

* **Consent Review:** Google Cloud Vision – SafeSearch

* **Weather API**:OpenWeather(weather query)

* **AI Services:&#x20;**&#x47;emini (reasoning for recommendation), Nano Banana (image generation)

* **Deployment:** Vercel for web app and serverless APIs, Render for long-running workers

* **Testing:** Vitest

## Appendix:

Gemini API Additional Terms of Service: https://ai.google.dev/gemini-api/docs/zdr

Cloud Vision API — Data Usage FAQ: https://docs.cloud.google.com/vision/docs/data-usage

