# AI Prompts Log — HW 4

This file logs the prompts typed while completing this assignment, organized by problem.

## Problem 1: Vibe coder prompts

**Prompts:**

1. We will be working on a homework project for my AI class in this folder. Please start a AI prompts logger similar to the one used in this previous homework assignment:

   '/Users/matthewagurcia/Documents/MBA/Fa26/MGT-409_AI/hw 3/AI_prompts.md'

**Notes:**

---

## Problem 2: Analyze the database

**Prompts:**

1. thanks, now for this project we will be doing a real customer website with a helpful chatbot for campus merchandise store "Campus Customs". We will build a React + Vite TypeScript front end and a Python FastAPI backend whose brain is a pydanticAI agent. Shoppers need to be able to browse products, create an account, chat about merch, see matching items appear on the page, and get honest reviews about price/stock from a local database.

   The folder has campus_customs.db with tables for the product catalogue, inventory by size, and users with hashed passwords. The image files are embedded as paths in the catalogue table. Research yalebulldogblue.com to learn about the style of Campus Customs and get information for the agent prompt.

   Use the PORTKEY_API_KEY for the agent's API calls; feel free to use any of the models in the 5.6 or 6 series; you may want to use a smarter model for harder agent steps; perhaps we use terra or sol?

   Anyways, we will be working through problems 1-12 which are the flow of the project, please only do the work associated per step. Do not jump ahead and start coding stuff I have not asked for. Problem 1 was asking to build the AI_prompts.md file.

   Problem 2 is the following:
   Look at the database campus_customs.db and understand the fields of each table. Start the file output/harness.md. Write down each table and its fields, and one short line on why each field matters for the shop or the chatbot.

   We will keep growing this harness file in later problems (models, tools, safety, specs)

**Notes:**

---

## Problem 3: Build the Campus Customs website

**Prompts:**

1. Problem 3: Alright, let's scaffold a react + vite + typescript front end for campus customs. Put a nav bar at the top that links the main pages (Home, Products, About Us, Log in, Create Account). Pull Campus customs' style of wording from the website, yalebulldogblue.com, for Home and About Us. BUT PLEASE WRITE THESE PAGES IN YOUR OWN VOICE; DO NOT COPY THE ORIGINAL SITE TEXT.

   On the Products Page, open a single-item page (large image on one side, full product text on the other - description, price, sizes/stock where you have them). Clicking a card on Products should take the shopper there.

   Add a chat interface on the bottom right of the site (a floating chat panel is fine). It does not need to talk to an agent yet - a stub that will call your backend later is enough for this problem.

   You will need a small API to read the database. It is fine to start a simple FastAPI app in backend/main.py just to serve the products and images (then we'll grow it into the agent backend in a later problem)

   I want the website to have a modern, clean, minimalist bauhaus design, but without the geometric shapes. For the layout/font/colors, please follow the guidelines on the official Yale website guidance:

   https://yaleidentity.yale.edu/guidelines/websites

**Notes:**

---

## Problem 4: Create account and login

**Prompts:**

1. Okay, moving onto p4. Create a normal "create-account" and login flow.

   For create account, this should ask for first name, last name, email, password, and preferably confirm password. both password options should have the button to show or hide your input.

   For login, obviously just ask for email and password

   New accounts go into the 'users' table. Make sure to store passwords securely so no hackers, both human or AI, can access them.

   the seed db already has test users you can use while building; i.e. test@campuscustoms.yale.edu; password: "password".

   Please confirm that you can log in as that user, and that a brand-new account you create also works.

   Also, update the output/harness.md with how the authorization protocol works, what you store for a user, and how you chose to protect passwords.

**Notes:**

---

## Problem 5: PydanticAI agent backend

**Prompts:**

1. Sweet, thank you. Now problem 5: now we'll build the shop chatbot as a PydanticAI agent behind FastAPI, plugged into the front-end chat widget. Put the API app in backend/main.py - that's the file we'll run with Uvicorn. Keep the agent as these four files next to it:

   * backend/prompts/prompt.md (system prompt; grow this same file later)
   * backend/agent.py (agent entry / wiring)
   * backend/tools.py (tools the agent can call)
   * backend/models.py (Pydantic / PydanticAI structured types)

   In main.py, expose a chat route so a message from the website returns a reply from the agent (and whatever else you need for products/auth). You will need you AI model API key for this agent (i.e. PORTKEY_API_KEY)

   Put campus customs voice and safety basics into prompts/prompt.md (we'll expand tools and safety alter). Start or update types in models.py for chat replies / product cards as needed.

   In output/harness.md, note how the front end talks to FastAPI and how the agent is loaded (prompt file + model)

   Make sure the backend runs from the folder with this command line:
   uvicorn main:app --reload --port 8000

**Notes:**

---

## Problem 6: Tools: product info and stock

**Prompts:**

1. Sweet, let's move onto question 6.

   Give the agent tools that look up real information from campus_customs.db:

   * Product description
   * Price
   * How many are in stock (by size when queried, too)

   THE AGENT MUST USE THE DATABASE; IT SHOULD NOT INVENT PRICES OR QUANTITIES. If a size is out of stock, say so clearly!

   Expand prompts/prompt.md so the agent knows to call these tools for price and stock questions. Add or update return types in models.py.

   In output/harness.md, list each tool and explain which model fields you chose for lookup results and why.

**Notes:**

---

## Problem 7: Chat search that updates the page

**Prompts:**

1. thanks. now for question 7 let's add a neat feature. When a customer asks about a type of item, say for example "what hoodies do you have?" the agent should search the catalogue. But, at the same time, the website should dynamically show those matching items as product cards (image, name, price, short info). This is an API contract; the agent returns structured product matches and then the front end renders them on the website.

   After the dynamic product cards are loaded by your new feature, make sure the same single-item page behavior you built in Problem 3 still works: each product card (including the ones the chat just put on the page) should still open that detail view (large image + full info) when clicked.

   Update prompts/prompt.md and output/harness.md so it is clear how search results reach the page.

**Notes:**

---

## Problem 8: Customer memory

**Prompts:**

1. that limitation is okay. now let's do problem 8. When a shopper is logged in, save their chat history in the database in an appropriate table and reload it when they return. The agent should know who is chatting (i.e. name, email); put that in agent deps (or an equivalent clear pattern) and/or tools that the agent can call. Also pass enough page context that if someone is on a product page and asks "do you have this in pink?" the agent knows what item they mean. Putting code in the agent context is an acceptable workaround for that.

   Guests can still chat, but history only needs to persist for logged-in users. Document in output/harness.md how the user chat history is stored, what customer fields the agent sees, and how page context is passed.

**Notes:**

---

## Problem 9: Usability improvements

**Prompts:**

1. Alright, thank you. Now problem 9 is a tricky one; it's asking that now that the shop works, improve it. We need to implement two front-end usability improvements, as well as 2 agent/backend usability improvements.

   For context, we are defining front-end improvements as things that make the site look better and make it easier to use. For agent/backend improvements, these are things that make the agent output better, more accurate, or safer. These could be new agent tools or things that make the agent run faster or cheaper.

   Write output/usability.md before or as you build. For each of the improvements, say:

   * what you added
   * Why it helps a Campus customs shopper or the business

   Then, make sure all improvements actually show up in the running app. Graders will read the write-up and look for the features.

   So, here's what I'm thinking:
   For backend:

   * Make the chat agentic and have it deploy cheaper agents to potentially make each search query faster and cheaper. We did this in class previously, feel free to take inspiration from this assignment: '/Users/matthewagurcia/Documents/MBA/Fa26/MGT-409_AI/lecture 10'. Bonus points if you can add an animation in the chat like the project where you can see the boss agent interacting with the subagents and have it play fun pew-pew sounds.
   * Maybe there is a way to cache previous conversations for each person's account instead of making new queries to the AI API each time? That way it can have a bit of context and not have to start from scratch every time.

   For frontend

   * When the user asks the chat for an item that isn't an exact match or something is straight out of stock, feel free to give the user recommendations based on similar items. Not sure how you can accomplish this.
   * Similar to above, maybe you can add some functionality that recommends items that would complement an item well. For example if you're looking for a hoodie, have the agent recommend matching sweatpants or something like that. Try to make the recommendation really fashionable and usable; e.g. don't suggest a pink polyester hoodie if the person is looking at gray cotton sweatpants

   If you have any other recommendation that you'd think would add better functionality to the website, I'd be happy to evaluate it before you implement it. Just let me know. These ideas are just me spitballin.

2. Can you run the thing so I can see what we have?

**Notes:**

The improvements were built after the first prompt, but I hadn't seen them in the running app yet, so I asked for the site to be started before moving on.

---

## Problem 10: Style the website

**Prompts:**

1. Thanks, moving onto question 10. Let's do a bit of an overhaul of the design. Yes to both of your suggestions; please build both of those out (filters/sorting & size and fit helper).

   Now I want to add a more creative design so the site feels like a real campus customs storefront.

   * Go ahead an add a cart and "Add to cart" buttons on all the products
   * Keep the palette but change to a glassmorphism design and give it a very modern layout
   * Give the chat a persona; make it a bulldog mascot helper and call him Dan. Have it pop up and go "How can I help! Woof woof" or something like that with animals
   * Create a categories tab and divide by Tops/Bottoms/Men/Women or whatever categories you think work best for the items we have. Make the current categories (Residential colleges/varsity sports/graduate & professional schools/the whole family) as part of this as well. Put it on the menu with these other categories.
   * Try to add some animations where possible; give it a more animated feel

**Notes:**

My prompt left out the output/design.md write-up this problem asks for (what changed and why it should help customers stick around and buy); it was added in Problem 13 after I checked the project against the assignment pages.

---

## Problem 11: Site testing (app check)

**Prompts:**

1. Thanks, moving onto question 11. We're starting to close out the project.

   Test the live site and document it in output/app_check.html (a page I can open and operate locally).

   Include clear screenshots and short captions for:

   * Chat checking the inventory level of an item (honest stock/price from the DB)
   * The dynamic search-result cards appearing after a category question (e.g. hoodies)
   * Two of the usability features you added in Problem 9, perhaps the most showy/fancy one. Do one front end and one back end.

   Make the HTML easy to grade for the professor:

   1. Heading for each check
   2. Screenshot
   3. One or two sentences MAX on what the screenshot proves.
   4. Be comprehensive, cover everything we designed and all the functionalities

   Put the screenshot image files in output/app_check_images/ and link them from app_check.html with relative paths (e.g. app_check_images/inventory.png).

**Notes:**

---

## Problem 12: Audit trail, safety, finish harness

**Prompts:**

1. Picking up this from another chat in another account. Please try to get as much context from the existing website files and any leftover claude chat/contexts from the other sessions. Please fill out the AI_prompts.md document as necessary.

   Now we are going to problem 12. Keep an append-only output/audit_trail.json of agent-loop activity (time, tool name, short args/result, stop reason). DO NOT WIPE IT BETWEEN RUNS!

   Also, think of some sort of safety rules to give the agent and put them in prompts/prompt.md. For example, only talk about merchandise stuff; don't help someone do their math homework and run up our API credits. Or when engaging with rudeness/impoliteness, don't engage and immediately terminate the session.

   Finish output/harness.md so it is clear how the system works:

   * Model fields in models.py and why you chose them
   * tools and abilities
   * Safety rules
   * Specs (loop limits, result caps, models, how to run front + back)

**Notes:**

---

## Problem 13: Push to GitHub and submit the URL

**Prompts:**

1. thanks, that should be pretty much it. moving onto question 13, best and final.

   Put all the code in a folder called "hw4" and push it to a public GitHub Repo titled "Yale SOM, MGT-409 HW4". Please make sure that the structure and contents match exactly with what is on the file layout screenshot I provided.

   Do not put the real .env, campus_customs.db, or product images in the Github repo. Use .gitincore. Include .env.example with placeholders only.

   The agent itself is four files under backend/: prompts/prompt.md, agent.py, tools.py, and models.py

   README.md should explain how to run the front end and back end after placing the data pack.

   *(Screenshot attached: the expected file layout — `hw4/` with `AI_prompts.md`, `requirements.txt`, `.env.example`, `.gitignore`, `README.md`, `frontend/` (Vite React TypeScript app), `backend/` (`main.py`, `agent.py`, `models.py`, `tools.py`, `prompts/prompt.md`) and `output/` (`harness.md`, `design.md`, `usability.md`, `app_check.html`, `app_check_images/`, `audit_trail.json`); plus a local-only data pack, not in git: `data/campus_customs.db` and `data/products/`.)*

2. hi

3. Did you ever find what that design.md thing was?

4. Can you grade the project with what's on '/Users/matthewagurcia/Documents/MBA/Fa26/MGT-409_AI/hw 4/instructions'. Figure out if it's just a typo and make sure everything else is done to a T.

5. kill that stray uvicorn process on port 8000

6. how would you grade this? run the site so I can check it before submitting.

7. fix 1, 2, and 4

8. Keep as is. Don't do it just yet, but could we push this to the website through Cloud Run?

   /Users/matthewagurcia/Documents/agurcia.org

9. is the assignment good to submit?

10. What does this mean about harness.md?

    It's accurate, but it can't be cut safely now

11. Alright, I'm ready to start with the deployment of this to the website sandbox. Please create a folder in Documents/agurcia.org/sandbox assets (or something like that) to store all sandbox assets. Move any existing wizard assets that are elsewhere in here please, and any other sandbox assets that may be around.

    For the decisions for me part:

    1. Don't give it a passcode, but definitely add "Class project, not affiliated"
    2. We're good to use the portkey for now, but eventually they'll turn it off. So make it easy for me to swap with like an anthropic API key in the future. Or maybe even an LLM. Not sure what I'm going to do long term
    3. Resets is perfect; this is definitely just a demo
    4. call it "swag-demo.agurcia.org"
    5. We're good to deploy now

12. sorry I had to close my computer; please continue

13. it's up

**Notes:**

After the first push, design.md was still a guess because my Problem 10 prompt never asked for it, so I asked about it and then had the whole project graded against the assignment pages to close any remaining gaps. That pass found a chat shelf that could mix results, a stale harness diagram, a long design.md and outdated screenshots, so I asked for those fixes and then a final check before submitting.

---
