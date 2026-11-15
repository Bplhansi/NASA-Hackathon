
/*
 * EARTH DETECTIVE — P3
 * Community Solutions
 *
 * Ideas and votes are stored in this browser only.
 * No backend, accounts or global vote counts.
 */

const STORAGE_PREFIX = "ed.solutions.";
const modalRoot = document.getElementById("modal-root");

const EXAMPLE_IDEAS = [
  {
    id: "example-1",
    stage: "Before",
    text: "EXAMPLE IDEA: Protect wetlands and restore natural vegetation around vulnerable water sources to improve resilience during droughts.",
    votes: 0,
    example: true
  },
  {
    id: "example-2",
    stage: "After",
    text: "EXAMPLE IDEA: Organise local clean-up and habitat restoration projects after environmental disasters, with support from community volunteers.",
    votes: 0,
    example: true
  }
];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function storageKey(cardId) {
  return STORAGE_PREFIX + cardId;
}

function readIdeas(cardId) {
  try {
    const stored = JSON.parse(
      localStorage.getItem(storageKey(cardId)) || "null"
    );

    if (stored && Array.isArray(stored.ideas)) {
      return stored;
    }
  } catch (error) {
    console.warn("Could not read saved solutions:", error);
  }

  return {
    ideas: EXAMPLE_IDEAS.map((idea) => ({ ...idea })),
    votedIds: []
  };
}

function saveIdeas(cardId, data) {
  try {
    localStorage.setItem(
      storageKey(cardId),
      JSON.stringify(data)
    );
    return true;
  } catch (error) {
    console.warn("Could not save solutions:", error);
    return false;
  }
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `idea-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function closeSolutions() {
  if (modalRoot) {
    modalRoot.replaceChildren();
  }

  document.removeEventListener("keydown", onEscape);
}

function onEscape(event) {
  if (event.key === "Escape") {
    closeSolutions();
  }
}

export function openSolutions(cardId, title = "Earth Event") {
  if (!modalRoot || !cardId) return;

  let data = readIdeas(cardId);

  function render() {
    modalRoot.innerHTML = `
      <div class="modal-backdrop">
        <section
          class="modal-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="solutions-title"
        >
          <button
            class="modal-close"
            type="button"
            aria-label="Close solutions"
          >×</button>

          <p class="eyebrow">💡 COMMUNITY IDEAS</p>
          <h2 id="solutions-title">Solutions Lab</h2>

          <p class="feed-meta">
            For: ${escapeHTML(title)}
          </p>

          <p>
            What could communities do before, during or after
            this environmental challenge?
          </p>

          <div class="card">
            <label for="solution-stage" class="field-label">
              WHEN WOULD THIS HELP?
            </label>

            <select id="solution-stage" class="case-select">
              <option value="Before">Before</option>
              <option value="During">During</option>
              <option value="After">After</option>
            </select>

            <label
              for="solution-text"
              class="field-label"
              style="display:block;margin-top:16px"
            >
              YOUR IDEA
            </label>

            <textarea
              id="solution-text"
              class="solution-input"
              maxlength="280"
              placeholder="Share a practical idea in 280 characters..."
            ></textarea>

            <p class="helper-text">
              <span id="character-count">0</span>/280 characters
            </p>

            <button
              id="post-solution"
              class="btn"
              type="button"
            >
              💡 Post Idea
            </button>

            <p id="solution-message" class="helper-text"
              role="status"></p>
          </div>

          <h3>Community Ideas</h3>

          <div id="solutions-list">
            ${data.ideas.map((idea) => {
              const voted = data.votedIds.includes(idea.id);

              return `
                <article class="solution-item">
                  <div class="feed-meta">
                    ${escapeHTML(idea.stage)}
                    ${idea.example ? " · EXAMPLE IDEA" : " · YOUR IDEA"}
                  </div>

                  <p>${escapeHTML(idea.text)}</p>

                  <button
                    type="button"
                    class="btn btn-ghost"
                    data-vote="${escapeHTML(idea.id)}"
                    ${voted ? "disabled" : ""}
                  >
                    👍 ${voted ? "Voted" : "Vote"}
                    (${Number(idea.votes) || 0})
                  </button>
                </article>
              `;
            }).join("")}
          </div>

          <p class="helper-text">
            Ideas and votes are saved on this device only.
            Counts are not global or shared with other users.
            The first two ideas are illustrative examples.
          </p>

          <button
            type="button"
            class="btn btn-ghost"
            id="generate-video"
            disabled
            title="Coming soon"
          >
            🎬 Generate Video — Coming Soon
          </button>
        </section>
      </div>
    `;

    const backdrop = modalRoot.querySelector(".modal-backdrop");
    const closeButton = modalRoot.querySelector(".modal-close");
    const textarea = modalRoot.querySelector("#solution-text");
    const counter = modalRoot.querySelector("#character-count");
    const postButton = modalRoot.querySelector("#post-solution");
    const message = modalRoot.querySelector("#solution-message");
    const stageSelect = modalRoot.querySelector("#solution-stage");

    closeButton.addEventListener("click", closeSolutions);

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        closeSolutions();
      }
    });

    textarea.addEventListener("input", () => {
      counter.textContent = textarea.value.length;
    });

    postButton.addEventListener("click", () => {
      const text = textarea.value.trim();

      if (!text) {
        message.textContent = "Please write an idea first.";
        return;
      }

      if (text.length > 280) {
        message.textContent = "Keep your idea under 280 characters.";
        return;
      }

      const idea = {
        id: makeId(),
        stage: stageSelect.value,
        text,
        votes: 0,
        example: false
      };

      data.ideas.unshift(idea);

      if (!saveIdeas(cardId, data)) {
        data.ideas.shift();
        message.textContent =
          "Could not save the idea. Check browser storage settings.";
        return;
      }

      render();
    });

    modalRoot.querySelectorAll("[data-vote]").forEach((button) => {
      button.addEventListener("click", () => {
        const ideaId = button.dataset.vote;

        if (data.votedIds.includes(ideaId)) return;

        const idea = data.ideas.find(
          (item) => item.id === ideaId
        );

        if (!idea) return;

        idea.votes = (Number(idea.votes) || 0) + 1;
        data.votedIds.push(ideaId);

        if (!saveIdeas(cardId, data)) {
          idea.votes -= 1;
          data.votedIds.pop();
          return;
        }

        render();
      });
    });
  }

  document.removeEventListener("keydown", onEscape);
  document.addEventListener("keydown", onEscape);

  render();

  modalRoot.querySelector(".modal-close")?.focus();
}

// Listen for the event dispatched by feed.js.
document.addEventListener("solutions:open", (event) => {
  const { cardId, title } = event.detail || {};

  if (cardId) {
    openSolutions(cardId, title);
  }
});
