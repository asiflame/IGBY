const audio = document.getElementById("boot-audio");
const bootText = document.getElementById("boot-text");
const enterBtn = document.getElementById("enter-btn");

const lines = [
  "BOOTING SYSTEM...",
  "INITIALIZING AUDIO ENGINE",
  "CONNECTING TO THE WIRED",
  "LOADING ANIME MODULES",
  "CHECKING SANITY LEVEL... ???",
  "SYSTEM ONLINE"
];

let index = 0;

function typeLine() {
  if (index < lines.length) {
    bootText.textContent += lines[index] + "\n";
    index++;
    setTimeout(typeLine, 600);
  } else {
    enterBtn.classList.remove("hidden");
  }
}

document.addEventListener("click", () => {
  if (audio && audio.paused) audio.play();
});

typeLine();
