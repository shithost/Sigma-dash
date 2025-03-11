require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const axios = require('axios');
const flash = require('connect-flash');

const app = express();

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.set('view engine', 'ejs');

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_REDIRECT_URI,
  scope: ['identify', 'email']
},
(accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((obj, done) => {
  done(null, obj);
});

const checkVPN = async (req, res, next) => {
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  try {
    const response = await axios.get(`http://proxycheck.io/v2/${ip}?key=${process.env.PROXYCHECK_API_KEY}&vpn=1&proxy=1&asn=1&node=1&port=1&seen=1&inf=1&days=180`);
    const data = response.data[ip];
    if (data.proxy === 'yes' || data.vpn === 'yes' || data.tor === 'yes') {
      return res.status(403).send('VPN, Proxy, or Tor is not allowed.');
    }
    next();
  } catch (error) {
    console.error('Error checking VPN:', error);
    res.status(500).send('Internal Server Error');
  }
};

const generateRandomPassword = (length = 10) => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+[]{}|;:,.<>?';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return password;
};

const createUserOnPterodactyl = async (email, username, password) => {
  try {
    const response = await axios.post(`${process.env.PTERODACTYL_PANEL_URL}/api/application/users`, {
      email: email,
      username: username,
      first_name: username.split('#')[0],
      last_name: username.split('#')[1],
      password: password
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.PTERODACTYL_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'Application/vnd.pterodactyl.v1+json'
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error creating user on Pterodactyl:', error);
    throw error;
  }
};

app.use((req, res, next) => {
  res.locals.messages = req.flash();
  next();
});

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/dashboard');
  } else {
    res.render('index', { hostingName: process.env.HOSTING_NAME || 'Default Hosting Name' });
  }
});

app.get('/auth/discord', checkVPN, passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }),
  async (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user;
      const email = user.emails[0].value;
      const username = user.username;
      const password = generateRandomPassword();

      try {
        await createUserOnPterodactyl(email, username, password);
        req.flash('info', `Your Pterodactyl account has been created. Your password is: ${password}`);
        res.redirect('/dashboard');
      } catch (error) {
        console.error('Error creating user on Pterodactyl:', error);
        res.status(500).send('Error creating Pterodactyl account. Please try again later.');
      }
    } else {
      res.redirect('/');
    }
  });

app.get('/dashboard', (req, res) => {
  if (req.isAuthenticated()) {
    res.render('dashboard', { hostingName: process.env.HOSTING_NAME, user: req.user });
  } else {
    res.redirect('/');
  }
});

app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});