const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'secretkey',
  resave: false,
  saveUninitialized: true
}));

// SQLite Database connection
const db = new sqlite3.Database('./user.db', (err) => {
  if (err) {
    console.error("Error opening SQLite database: " + err.message);
  } else {
    console.log("Connected to the SQLite database.");

    // Ensure the 'search_log' table has the 'lat' and 'lon' columns if they don't exist
    db.all(`PRAGMA table_info(search_log);`, (err, columns) => {
      if (err) {
        console.error(err);
      } else {
        const columnNames = columns.map(col => col.name);

        if (!columnNames.includes('lat')) {
          db.run('ALTER TABLE search_log ADD COLUMN lat REAL;', (err) => {
            if (err) {
              console.error('Error adding lat column:', err.message);
            } else {
              console.log('Added lat column to search_log');
            }
          });
        }

        if (!columnNames.includes('lon')) {
          db.run('ALTER TABLE search_log ADD COLUMN lon REAL;', (err) => {
            if (err) {
              console.error('Error adding lon column:', err.message);
            } else {
              console.log('Added lon column to search_log');
            }
          });
        }
      }
    });

    // Create Users table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password TEXT
    )`);

    // Create search_log table if it doesn't exist
    db.run(`CREATE TABLE IF NOT EXISTS search_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      city TEXT,
      lat REAL,
      lon REAL
    )`);
  }
});


// Routes for login and register
app.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');  // Redirect to home page if already logged in
  }
  res.render('login', { error: null });
});

app.get('/register', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/');  // Redirect to home page if already logged in
  }
  res.render('register', { error: null });
});

// Handle POST request for login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error(err);
      return res.render('login', { error: 'Error occurred. Please try again.' });
    }

    if (!user) {
      return res.render('login', { error: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render('login', { error: 'Invalid password.' });
    }

    req.session.userId = user.id;
    req.session.userName = user.name || user.email; // Store userName in session
    res.redirect('/');
  });
});

// Handle POST request for registration
app.post('/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match.' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, existingUser) => {
    if (err) {
      console.error(err);
      return res.render('register', { error: 'Error occurred. Please try again.' });
    }

    if (existingUser) {
      return res.render('register', { error: 'Email already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashedPassword], (err) => {
      if (err) {
        console.error(err);
        return res.render('register', { error: 'Error occurred. Please try again.' });
      }
      res.redirect('/login');
    });
  });
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/login');
  });
});

// Weather Routes
app.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/login');  // Redirect to login if not logged in
  }

  res.render('index', {
    weather: null,
    forecast: null,
    hourlyForecast: null,
    airPollution: null,
    error: null,
    userName: req.session.userName || 'Guest'  // Pass the userName from session
  });
});

// Route to handle location-based search
app.post('/location', async (req, res) => {
  const { lat, lon } = req.body;
  const apiKey = process.env.WEATHER_API_KEY;

  try {
    const weatherURL = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastURL = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const airPollutionURL = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;

    const [weatherRes, forecastRes, airPollutionRes] = await Promise.all([
      axios.get(weatherURL),
      axios.get(forecastURL),
      axios.get(airPollutionURL),
    ]);

    const weather = weatherRes.data;
    const forecast = forecastRes.data.list.filter(item =>
      item.dt_txt.includes('12:00:00')
    );
    const hourlyForecast = forecastRes.data.list.slice(0, 6);
    const airPollution = airPollutionRes.data?.list[0] || null;

    // Log the geolocation search in the search_log table
    db.run('INSERT INTO search_log (city, lat, lon) VALUES (?, ?, ?)', ['User Location', lat, lon], (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log('Location search logged successfully');
      }
    });

    res.render('index', {
      weather,
      forecast,
      hourlyForecast,
      airPollution,
      error: null,
      userName: req.session.userName || 'Guest'
    });

  } catch (err) {
    console.error(err.message);
    res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Unable to retrieve weather data for your location. Please try again.',
      userName: req.session.userName || 'Guest'
    });
  }
});

// Route to handle manual city search
app.post('/manual', async (req, res) => {
  const city = req.body.city.trim();
  const apiKey = process.env.WEATHER_API_KEY;

  if (!city) {
    return res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'Please enter a city name.',
      userName: req.session.userName || 'Guest'  // Pass userName from session
    });
  }

  try {
    const geocodingURL = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}`;
    const geocodeRes = await axios.get(geocodingURL);
    const { lat, lon } = geocodeRes.data.coord;

    const weatherURL = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastURL = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const airPollutionURL = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;

    const [weatherRes, forecastRes, airPollutionRes] = await Promise.all([
      axios.get(weatherURL),
      axios.get(forecastURL),
      axios.get(airPollutionURL),
    ]);

    const weather = weatherRes.data;
    const forecast = forecastRes.data.list.filter(item =>
      item.dt_txt.includes('12:00:00')
    );
    const hourlyForecast = forecastRes.data.list.slice(0, 6);
    const airPollution = airPollutionRes.data?.list[0] || null;

    // Log the city search in the search_log table
    db.run('INSERT INTO search_log (city, lat, lon) VALUES (?, ?, ?)', [city, lat, lon], (err) => {
      if (err) {
        console.error(err);
      } else {
        console.log('Search term logged successfully');
      }
    });

    res.render('index', {
      weather,
      forecast,
      hourlyForecast,
      airPollution,
      error: null,
      userName: req.session.userName || 'Guest'  // Pass userName from session
    });

  } catch (err) {
    console.error(err.message);
    res.render('index', {
      weather: null,
      forecast: null,
      hourlyForecast: null,
      airPollution: null,
      error: 'City not found or API failed. Please try again.',
      userName: req.session.userName || 'Guest'  // Pass userName from session
    });
  }
});

// Search stats route
app.get('/search-stats', (req, res) => {
  db.all('SELECT city, COUNT(*) AS count FROM search_log GROUP BY city ORDER BY count DESC', (err, rows) => {
    if (err) {
      return res.status(500).send('Error retrieving search stats');
    }

    const searchData = rows.map(row => ({
      city: row.city,
      count: row.count
    }));

    res.json(searchData);
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
