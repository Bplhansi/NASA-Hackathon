
/*
 * EARTH DETECTIVE — P3
 * Main application: navigation, scan controls and integration.
 */

import { CASES } from "./cases.js";
import { runScan, mountTerminal } from "./scan.js";
import { loadFeed } from "./feed.js";
import "./solutions.js";

// Register P2's chart event listeners.
import "./chart.js";
import { renderTimeMachine } from "./timemachine.js";

// --------------------------------------------------
// DOM ELEMENTS
// --------------------------------------------------

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".tab-panel");
const casePicker = document.getElementById("case-picker");
const scanButton = document.getElementById("run-scan");
const terminal = document.getElementById("terminal");
const toastRoot = document.getElementById("toast");

let scanning = false;

// --------------------------------------------------
// NAVIGATION
// --------------------------------------------------

function goToTab(tabName) {
  const validTabs = ["scan", "time", "feed"];

  if (!validTabs.includes(tabName)) {
    tabName = "scan";
  }

  tabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;

    tab.classList.toggle("active", active);

    if (active) {
      tab.setAttribute("aria-current", "page");
    } else {
      tab.removeAttribute("aria-current");
    }
  });

  panels.forEach((panel) => {
    const active = panel.id === `tab-${tabName}`;

    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });

  try {
    localStorage.setItem("ed.activeTab", tabName);
  } catch {
    // The website still works if storage is unavailable.
  }
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    goToTab(tab.dataset.tab);
  });
});

// Allow other modules to navigate between tabs.
document.addEventListener("nav:go", (event) => {
  goToTab(event.detail?.tab);
});

// --------------------------------------------------
// NOTIFICATIONS
// --------------------------------------------------

function showToast(message) {
  if (!toastRoot) return;

  const notification = document.createElement("div");
  notification.className = "toast";
  notification.textContent = message;

  toastRoot.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// --------------------------------------------------
// CASE PICKER
// --------------------------------------------------

function populateCases() {
  if (!casePicker) return;

  casePicker.replaceChildren();

  CASES.forEach((caseStudy) => {
    const option = document.createElement("option");

    option.value = caseStudy.id;
    option.textContent =
      `${caseStudy.name} — ${caseStudy.country || ""}`;

    casePicker.appendChild(option);
  });

  if (CASES.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No investigation sites available";
    casePicker.appendChild(option);

    if (scanButton) {
      scanButton.disabled = true;
    }
  }
}

// --------------------------------------------------
// SCAN CONTROLS
// --------------------------------------------------

async function startScan() {
  if (scanning || !casePicker?.value) return;

  scanning = true;
  scanButton.disabled = true;
  scanButton.textContent = "🛰️ Investigating Earth...";

  goToTab("scan");

  try {
    await runScan(casePicker.value);
  } catch (error) {
    console.error("Scan failed:", error);
    showToast("The investigation could not finish. Try again.");
  } finally {
    scanning = false;
    scanButton.disabled = false;
    scanButton.textContent = "🛰️ Run Detective Scan";
  }
}

scanButton?.addEventListener("click", startScan);

// P1's scan engine can also report errors through events.
document.addEventListener("scan:error", (event) => {
  showToast(
    event.detail?.message ||
    "NASA imagery could not be loaded."
  );
});

// --------------------------------------------------
// SCAN RESULTS
// --------------------------------------------------

// P2's chart.js handles its own scan:done event.
// Render the Time Machine when a scan completes.
document.addEventListener("scan:done", (event) => {
  const result = event.detail;

  if (!result) return;

  try {
    renderTimeMachine(
      result,
      document.getElementById("timemachine")
    );
  } catch (error) {
    console.error("Time Machine rendering error:", error);
    showToast("The Time Machine could not display this scan.");
  }

  // feed.js independently listens for scan:done
  // and adds the investigation to Earth Feed.
});

// --------------------------------------------------
// INITIALIZE APP
// --------------------------------------------------

function init() {
  populateCases();

  // Connect P1's investigation terminal.
  mountTerminal(terminal);

  // Fetch real NASA EONET events for Earth Feed.
  loadFeed().catch((error) => {
    console.error("Earth Feed initialization failed:", error);
  });

  // Restore the user's last selected tab.
  let savedTab = "scan";

  try {
    savedTab = localStorage.getItem("ed.activeTab") || "scan";
  } catch {
    // Ignore storage restrictions.
  }

  goToTab(savedTab);

  console.log("🌍 Earth Detective initialized.");
}

init();
