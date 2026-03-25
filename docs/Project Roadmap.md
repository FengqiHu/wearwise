# Project Roadmap

## Iteration 1

**Dates:** Week 6-7

**Goal:** Build the foundational workflow

**Must-to-Have Features**

- Google OAuth login
- Users can create personal accounts/profiles with their own images (face and full-body), height and weight.
- Users can upload images of clothing items.
- Users can communicate their clothing needs to the system (chatting).
- Create try-on image generation api.
- The system analyzes uploaded clothing images and extracts clothing features, generating cloth's name, category (tops, pants, shoes, etc.), and description.

## Iteration 2

**Dates:** Week 8-10

**Goal:** Deliver the core workflow of clothing recommendations

**Must-to-Have Features**

- Users can replace and delete images of clothing items.
- The system contains mock test data for user to import.
- The system can invoke a weather query tool to get the weather conditions.
- The system recommends three distinct outfits (with no duplicate outfit combinations) per request based on the cloud closet, users' needs and weather.
- The system generates try-on images based on the recommended outfits and profile image.

**Nice-to-Have Features:**

- Users can select specific clothes from the cloud closet and request outfit recommendations based only on the selected items.

## Iteration 3

**Dates:** Week 11-12

**Goal:** Personalization and feedback loop

**Must-to-Have Features**

- Users can replace and delete their profile information (images, weight, and height).
- Users can modify the features (including name, category, tag, and description) of their clothes.
- Users can vote for some outfits from the recommendation results.
- The system can summeriuze user's preferences and votes to give more personalized recommendations in future sessions.

**Nice-to-Have Features**

- The system can recognize and recommend accessories (jewelry, hats, bags) with outfits and include them as optional add-ons in outfit recommendations.

## Iteration 4

**Dates:** Week 13-14

**Goal:** User experience expansion

**Must-to-Have Features**

- The system can store chat sessions and generate try-on images in a user-accessible history page where users can view past results.
- Users can upload an online product image, receive outfit recommendations that incorporate the new item, and request a visual try-on.

**Nice-to-Have Features**

- Users can permanently delete their accounts.
- The system will automatically detect illegal and offensive content.