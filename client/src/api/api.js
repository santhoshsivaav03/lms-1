import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from '../utils/config';
import { Platform } from 'react-native';

// Determine if we're in a production build
const isProduction = !__DEV__;

// Log for both dev and production
const logAPI = (message, data) => {
    if (__DEV__) {
        console.log(message, data);
    } else {
        // In production, still log important API events but with less detail
        console.log(message);
    }
};

// Get the appropriate API URL based on environment
const getAPIUrl = () => {
    // For production Android, ensure we're using https
    if (isProduction && Platform.OS === 'android') {
        // Make sure API_URL is https
        if (API_URL.startsWith('http:')) {
            return API_URL.replace('http:', 'https:');
        }
    }
    return API_URL;
};

const api = axios.create({
    baseURL: getAPIUrl(),
    headers: {
        'Content-Type': 'application/json',
    },
    withCredentials: false,
    // Add timeouts for production builds
    timeout: isProduction ? 30000 : 0, // 30 seconds timeout in production
});

// Add token to requests
api.interceptors.request.use(async (config) => {
    try {
        logAPI('API Request:', config.url);

        const token = await SecureStore.getItemAsync('authToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        // Don't modify Content-Type for FormData
        if (config.data instanceof FormData) {
            delete config.headers['Content-Type'];
        }
        return config;
    } catch (error) {
        console.error('Error getting token:', error);
        return config;
    }
});

// Handle response errors
api.interceptors.response.use(
    (response) => {
        logAPI('API Response Success:', response.config.url);
        return response;
    },
    async (error) => {
        // Log detailed error information
        console.error('API Error:', {
            url: error.config?.url,
            status: error.response?.status,
            message: error.message,
            data: error.response?.data
        });

        const originalRequest = error.config;

        // If the error is 401 and we haven't tried to refresh the token yet
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;

            try {
                // Try to refresh the token
                const refreshToken = await SecureStore.getItemAsync('refreshToken');
                if (refreshToken) {
                    const response = await axios.post(`${getAPIUrl()}/auth/refresh-token`, {
                        refreshToken
                    });

                    if (response.data.token) {
                        // Save the new token
                        await SecureStore.setItemAsync('authToken', response.data.token);

                        // Update the original request with the new token
                        originalRequest.headers.Authorization = `Bearer ${response.data.token}`;

                        // Retry the original request
                        return api(originalRequest);
                    }
                }
            } catch (refreshError) {
                console.error('Error refreshing token:', refreshError);
            }

            // If refresh failed or no refresh token, clear tokens and let the app handle the redirect
            await SecureStore.deleteItemAsync('authToken');
            await SecureStore.deleteItemAsync('refreshToken');
        }

        return Promise.reject(error);
    }
);

// Additional logging for development
if (__DEV__) {
    api.interceptors.request.use(request => {
        console.log('Starting Request:', request);
        return request;
    });

    api.interceptors.response.use(response => {
        console.log('Response:', response);
        return response;
    });
}

export default api; 