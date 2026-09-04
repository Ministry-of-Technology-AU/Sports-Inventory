import fetch from "node-fetch";

let authToken = null;
let refreshToken = null;

const BASE_URL = process.env.BASE_URL;


/**
 * Logs into the Ashoka API and retrieves authentication tokens.
 */
async function login() {
  try {
    const response = await fetch(
      `${BASE_URL}api/TPIntegration/Login`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          UserId: process.env.USER_ID,
          Password: process.env.PASSWORD
        })
      }
    );

    const data = await response.json();

    if (data.ErrorCode === 0) {
      authToken = data.Token;
      refreshToken = data.RefreshToken;

      console.log("QR API login successful.");

      return authToken;
    }

    console.error("QR API login failed:", data.ErrorMessage);

    return null;

  } catch (error) {
    console.error("QR API login error:", error.message);
    return null;
  }
}


/**
 * Refreshes the authentication token.
 */
async function refreshAuthToken() {
  try {

    if (!refreshToken) {
      return await login();
    }

    const response = await fetch(
      `${BASE_URL}api/User/RefreshToken`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          Token: authToken,
          RefreshToken: refreshToken
        })
      }
    );

    const data = await response.json();

    if (data.ErrorCode === 0) {

      authToken = data.Token;
      refreshToken = data.RefreshToken;

      console.log("QR API token refreshed.");

      return authToken;
    }

    console.warn("Token refresh failed. Logging in again.");

    return await login();

  } catch (error) {

    console.error("Token refresh error:", error.message);

    return null;
  }
}


/**
 * Validates a QR code and returns the student's Ashoka ID.
 */
export async function processQr(qrString) {

  if (!qrString) {
    return {
      isValid: false,
      error: "QR code is required"
    };
  }


  // DEVELOPMENT MODE
  // Allows normal roll numbers to be used while API access is unavailable.
  if (process.env.ENVIRONMENT === "DEVELOPMENT") {

    return {
      isValid: true,
      ashokaId: qrString.trim()
    };

  }


  try {

    const decodedQr = decodeURIComponent(qrString.trim());


    // Get token if we don't already have one
    if (!authToken) {

      await login();

      if (!authToken) {
        return {
          isValid: false,
          error: "Unable to authenticate with QR validation service"
        };
      }
    }


    const response = await fetch(
      `${BASE_URL}api/TPIntegration/ValidateQRCodeTP`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        },

        body: JSON.stringify({
          QRCodeValue: decodedQr
        })
      }
    );


    const data = await response.json();


    // Handle expired token
    if (
      data.ErrorCode !== 0 &&
      data.ErrorMessage?.toLowerCase().includes("token")
    ) {

      await refreshAuthToken();

      if (!authToken) {
        return {
          isValid: false,
          error: "Unable to refresh authentication token"
        };
      }

      // Retry validation once
      const retryResponse = await fetch(
        `${BASE_URL}api/TPIntegration/ValidateQRCodeTP`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${authToken}`
          },

          body: JSON.stringify({
            QRCodeValue: decodedQr
          })
        }
      );

      const retryData = await retryResponse.json();

      if (retryData.ErrorCode !== 0) {
        return {
          isValid: false,
          error: retryData.ErrorMessage
        };
      }

      return {
        isValid: true,
        ashokaId: retryData.AshokaId
      };
    }


    // Invalid QR
    if (data.ErrorCode !== 0) {

      return {
        isValid: false,
        error: data.ErrorMessage
      };

    }


    // Valid QR
    return {

      isValid: true,
      ashokaId: data.AshokaId

    };

  } catch (error) {

    console.error("QR validation error:", error.message);

    return {
      isValid: false,
      error: error.message
    };

  }
}