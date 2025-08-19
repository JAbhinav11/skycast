/* CONFIG */
const API_KEY = window.OPENWEATHER_API_KEY; // provided by user
const DEFAULT_CITY = { name: "Bengaluru", state: "", country: "IN", lat: 12.9716, lon: 77.5946 };

/* DOM */
const cityInput = document.getElementById("cityInput");
const suggestions = document.getElementById("suggestions");
const useLocationBtn = document.getElementById("useLocationBtn");
const placeName = document.getElementById("placeName");
const updatedAt = document.getElementById("updatedAt");
const tempNow = document.getElementById("tempNow");
const currentIcon = document.getElementById("currentIcon");
const feelsLike = document.getElementById("feelsLike");
const humidity = document.getElementById("humidity");
const wind = document.getElementById("wind");
const pressure = document.getElementById("pressure");
const uvi = document.getElementById("uvi");
const visibility = document.getElementById("visibility");
const weatherDesc = document.getElementById("weatherDesc");
const forecastGrid = document.getElementById("forecastGrid");
const toggleUnitsBtn = document.getElementById("toggleUnits");
const modeSwitch = document.getElementById("modeSwitch");

/* STATE */
let units = (localStorage.getItem("units") || "metric"); // 'metric' | 'imperial'
let theme = (localStorage.getItem("theme") || "light"); // 'light' | 'dark'
document.documentElement.setAttribute("data-theme", theme);
modeSwitch.checked = theme === "dark";

let abortSuggest;
const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/* Helpers */
const fmtTemp = (t) => (t != null ? `${Math.round(t)}°` : "—");
const fmtWind = (speed) => `${Math.round(speed)} ${units === "metric" ? "m/s" : "mph"}`;
const fmtVisibility = (v) => (v != null ? `${(v/1000).toFixed(1)} km` : "—");
const fmtPressure = (p) => (p != null ? `${p} hPa` : "—");
const tsToLocal = (ts, tzOffsetSec) => {
  // returns a Date localized by timezone offset from One Call
  return new Date((ts + tzOffsetSec) * 1000);
};
const weekdayShort = (date) => date.toLocaleDateString(undefined, { weekday: "short" });
const monthDay = (date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* Fetchers */
async function geocodeSearch(query, limit = 8) {
  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=${limit}&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding failed");
  return res.json();
}

async function reverseGeocode(lat, lon) {
  const url = `https://api.openweathermap.org/geo/1.0/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Reverse geocoding failed");
  const [place] = await res.json();
  return place || { name: "Unknown", country: "" };
}

async function fetchOneCall(lat, lon) {
  // Prefer One Call 2.5 for broad compatibility
  const base = `https://api.openweathermap.org/data/2.5/onecall`;
  const url = `${base}?lat=${lat}&lon=${lon}&exclude=minutely,hourly,alerts&units=${units}&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    // Fallback: try aggregating 5 day / 3 hour into daily (gives ~5 days)
    // We'll still attempt to present 7 slots, repeating last if needed.
    return fallbackFiveDay(lat, lon);
  }
  const data = await res.json();
  data._source = "onecall";
  return data;
}

async function fallbackFiveDay(lat, lon) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast fetch failed");
  const data = await res.json(); // list every 3 hours, city has timezone
  const byDay = new Map();
  for (const item of data.list) {
    const dayKey = item.dt_txt.slice(0, 10); // YYYY-MM-DD
    const cur = byDay.get(dayKey) || { temps: [], hum: [], wind: [], pressure: [], icons: [] };
    cur.temps.push(item.main.temp);
    cur.hum.push(item.main.humidity);
    cur.wind.push(item.wind.speed);
    cur.pressure.push(item.main.pressure);
    cur.icons.push(item.weather?.[0]?.icon);
    byDay.set(dayKey, cur);
  }
  const days = Array.from(byDay.entries()).slice(0, 7).map(([day, agg]) => {
    const avg = (arr) => arr.reduce((a,b)=>a+b,0)/arr.length;
    return {
      dt: Math.floor(new Date(day + "T12:00:00Z").getTime()/1000),
      temp: { min: Math.min(...agg.temps), max: Math.max(...agg.temps), day: avg(agg.temps) },
      humidity: Math.round(avg(agg.hum)),
      pressure: Math.round(avg(agg.pressure)),
      wind_speed: avg(agg.wind),
      weather: [{ description: "", icon: agg.icons.sort((a,b)=>agg.icons.filter(x=>x===a).length - agg.icons.filter(x=>x===b).length).pop() || "01d" }]
    };
  });
  const now = data.list[0];
  return {
    _source: "5day",
    lat, lon,
    timezone_offset: data.city.timezone || 0,
    current: {
      dt: now.dt,
      temp: now.main.temp,
      feels_like: now.main.feels_like,
      humidity: now.main.humidity,
      pressure: now.main.pressure,
      visibility: now.visibility,
      wind_speed: now.wind.speed,
      uvi: 0,
      weather: now.weather
    },
    daily: days
  };
}

/* UI Rendering */
function setPlaceTitle(place) {
  const parts = [place.name, place.state, place.country].filter(Boolean);
  placeName.textContent = parts.join(", ");
}

function renderCurrent(data, place) {
  setPlaceTitle(place);
  const tz = data.timezone_offset || 0;
  updatedAt.textContent = `Updated ${monthDay(tsToLocal(data.current.dt, tz))} ${tsToLocal(data.current.dt, tz).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`;
  tempNow.textContent = fmtTemp(data.current.temp);
  const icon = data.current.weather?.[0]?.icon || "01d";
  const desc = data.current.weather?.[0]?.description || "";
  currentIcon.src = `https://openweathermap.org/img/wn/${icon}@2x.png`;
  currentIcon.alt = desc;
  feelsLike.textContent = fmtTemp(data.current.feels_like);
  humidity.textContent = `${data.current.humidity ?? "—"}%`;
  wind.textContent = fmtWind(data.current.wind_speed ?? 0);
  pressure.textContent = fmtPressure(data.current.pressure);
  uvi.textContent = data.current.uvi != null ? `${Math.round(data.current.uvi)}` : "—";
  visibility.textContent = fmtVisibility(data.current.visibility);
  weatherDesc.textContent = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "—";
}

function renderForecast(data) {
  const tz = data.timezone_offset || 0;
  forecastGrid.innerHTML = "";
  const days = (data.daily || []).slice(0,6);
  for (const d of days) {
    const date = tsToLocal(d.dt, tz);
    const icon = d.weather?.[0]?.icon || "01d";
    const el = document.createElement("div");
    el.className = "day";
    el.innerHTML = `
      <div class="d">${weekdayShort(date)}</div>
      <div class="date subtle">${monthDay(date)}</div>
      <img src="https://openweathermap.org/img/wn/${icon}@2x.png" alt="" />
      <div class="hi">${fmtTemp(d.temp?.max)}</div>
      <div class="lo">${fmtTemp(d.temp?.min)}</div>
    `;
    forecastGrid.appendChild(el);
  }
}

/* Data flow */
async function loadByCoords(lat, lon, placeInfo) {
  try {
    const data = await fetchOneCall(lat, lon);
    const place = placeInfo || await reverseGeocode(lat, lon);
    renderCurrent(data, place);
    renderForecast(data);
    localStorage.setItem("lastPlace", JSON.stringify({ name: place.name, state: place.state, country: place.country, lat, lon }));
  } catch (err) {
    console.error(err);
    alert("Sorry, couldn't fetch weather right now.");
  }
}

const doSuggest = debounce(async (q) => {
  if (!q || q.trim().length < 2) { suggestions.classList.remove("show"); suggestions.innerHTML = ""; return; }
  try {
    if (abortSuggest) abortSuggest.abort();
    abortSuggest = new AbortController();
    const res = await fetch(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=8&appid=${API_KEY}`, { signal: abortSuggest.signal });
    if (!res.ok) return;
    const places = await res.json();
    suggestions.innerHTML = "";
    places.forEach((p, idx) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.tabIndex = 0;
      li.textContent = [p.name, p.state, p.country].filter(Boolean).join(", ");
      li.addEventListener("click", () => {
        cityInput.value = li.textContent;
        suggestions.classList.remove("show");
        loadByCoords(p.lat, p.lon, p);
      });
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") li.click(); });
      suggestions.appendChild(li);
    });
    suggestions.classList.toggle("show", places.length > 0);
  } catch (e) {
    // ignore if aborted
  }
}, 250);

/* Events */
cityInput.addEventListener("input", (e) => doSuggest(e.target.value));
document.addEventListener("click", (e) => {
  if (!document.querySelector(".input-wrap").contains(e.target)) {
    suggestions.classList.remove("show");
  }
});

useLocationBtn.addEventListener("click", () => {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      position => {
        console.log("Latitude: " + position.coords.latitude);
        console.log("Longitude: " + position.coords.longitude);
      },
      error => {
        console.error("Error Code = " + error.code + " - " + error.message);
      }
    );
  } else {
    console.log("Geolocation is not supported by this browser.");
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      loadByCoords(latitude, longitude);
    },
    (err) => {
      alert("Couldn't get your location. Please allow permission or search manually.");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
});

toggleUnitsBtn.addEventListener("click", () => {
  units = units === "metric" ? "imperial" : "metric";
  localStorage.setItem("units", units);
  toggleUnitsBtn.textContent = units === "metric" ? "Switch to °F" : "Switch to °C";
  const last = JSON.parse(localStorage.getItem("lastPlace") || "null") || DEFAULT_CITY;
  loadByCoords(last.lat, last.lon, last);
});

modeSwitch.addEventListener("change", () => {
  theme = modeSwitch.checked ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
});

/* Init */
(function init() {
  // theme
  document.documentElement.setAttribute("data-theme", theme);
  modeSwitch.checked = theme === "dark";
  toggleUnitsBtn.textContent = units === "metric" ? "Switch to °F" : "Switch to °C";

  const last = JSON.parse(localStorage.getItem("lastPlace") || "null");
  if (last?.lat && last?.lon) {
    setPlaceTitle(last);
    loadByCoords(last.lat, last.lon, last);
  } else {
    setPlaceTitle(DEFAULT_CITY);
    loadByCoords(DEFAULT_CITY.lat, DEFAULT_CITY.lon, DEFAULT_CITY);
  }
})();


/* DOM */
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const saveSettings = document.getElementById("saveSettings");
const cancelSettings = document.getElementById("cancelSettings");
const userNameInput = document.getElementById("userName");
const greetingEl = document.getElementById("greeting");

/* Greeting Helper */
function getGreeting(name) {
  const hour = new Date().getHours();
  let greet;
  if (hour < 12) greet = "Good morning";
  else if (hour < 18) greet = "Good afternoon";
  else greet = "Good evening";
  return name ? `${greet}, ${name}!` : greet;
}

/* Show greeting */
function showGreeting() {
  const storedName = localStorage.getItem("userName") || "";
  greetingEl.textContent = getGreeting(storedName);
}

/* Settings Events */
settingsBtn.addEventListener("click", () => {
  settingsModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  userNameInput.value = localStorage.getItem("userName") || "";
  modeSwitch.checked = theme === "dark"; // sync toggle
});

function closeModal() {
  settingsModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

closeSettings.addEventListener("click", closeModal);
cancelSettings.addEventListener("click", closeModal);

saveSettings.addEventListener("click", () => {
  const name = userNameInput.value.trim();
  localStorage.setItem("userName", name);
  showGreeting();
  closeModal();
});

/* Close on ESC */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) {
    closeModal();
  }
});

/* Init Greeting */
showGreeting();
