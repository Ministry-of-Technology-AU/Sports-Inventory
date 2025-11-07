// passport-config.js
import path from 'path'
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv'; // Load environment variables from a .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import passport from "passport"; // Passport for authentication
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

const allowedEmails = process.env.ALLOWED_EMAILS ? process.env.ALLOWED_EMAILS : []; // Allowed email addresses for authentication
// console.log(process.env.ALLOWED_EMAILS);
// Configure Google OAuth 2.0 strategy for Passport.js
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.CLIENT_ID, // Google OAuth client ID
            clientSecret: process.env.CLIENT_SECRET, // Google OAuth client secret
            callbackURL: process.env.CALLBACK_URL, // Callback URL after Google authentication
        },
        (accessToken, refreshToken, profile, done) => {
            const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;

            if (!email) {
                console.log('No email found in profile');
                return done(null, false, { message: 'No email found in profile' });
            }

            if (!allowedEmails.includes(email)) {
                console.log('Email not authorized', email);
                return done(null, false, { message: 'Email not authorized' });
            }

            return done(null, profile); // Store the user's profile data
        }
    )
);

// Serialize and deserialize user information for Passport.js
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

export default passport;