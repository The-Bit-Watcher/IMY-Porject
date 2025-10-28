import axios from 'axios';

const API_BASE_URL = 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
   withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    // For debugging, you can add the localStorage ID as a header
    const localUserId = localStorage.getItem('userId');
    if (localUserId) {
      config.headers['X-User-ID'] = localUserId; // for debugging 
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Auth API calls
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  signup: (userData) => api.post('/auth/signup', userData),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/users/me'),
};

// User API calls  
export const userAPI = {
  getProfile: (userId) => api.get(`/users/${userId}`),
  getCurrentUser: () => api.get('/users/me'),
  updateCurrentUser: (userData) => api.put('/users/me', userData),
  updateProfile: (userId, userData) => api.put(`/users/${userId}`, userData),
  updateProfileSimple: (userId, userData) => api.put('/users/update-profile', { userId, updateData: userData }),
  getBulkUsers: (userIds) => api.get(`/users/bulk?ids=${userIds.join(',')}`),
};


export const projectsAPI = {
  getAll: () => api.get('/projects'),
  getById: (projectId) => api.get(`/projects/${projectId}`),
  create: (projectData) => api.post('/projects', projectData),
  update: (projectId, projectData) => api.put(`/projects/${projectId}`, projectData),
  delete: (projectId) => api.delete(`/projects/${projectId}`),
  uploadImage: (projectId, imageData) => api.post(`/projects/${projectId}/image`, imageData),
  uploadFiles: (projectId, filesData) => api.post(`/projects/${projectId}/files`, filesData),
  getFile: (projectId, fileIndex) => api.get(`/projects/${projectId}/files/${fileIndex}`),
  checkOut: (projectId) => api.post(`/projects/${projectId}/checkout`),
  checkIn: (projectId, checkInData) => api.post(`/projects/${projectId}/checkin`, checkInData),
};

export const friendsAPI = {
  sendRequest: (friendId) => api.post('/friends/request', { friendId }),
  acceptRequest: (requesterId) => api.post('/friends/accept', { requesterId }),
  declineRequest: (requesterId) => api.post('/friends/decline', { requesterId }),
  cancelRequest: (friendId) => api.post('/friends/cancel', { friendId }),
  getRequests: () => api.get('/friends/requests'),
  getSentRequests: () => api.get('/friends/sent-requests'),
  removeFriend: (friendId) => api.delete('/friends/remove', { data: { friendId } }),
};

export const usersAPI = {
  getProfile: (userId) => api.get(`/users/${userId}`),
  updateProfile: (userData) => api.put('/users/profile', userData),
  search: (query) => api.get(`/users/search?q=${query}`),
  getFriends: (userId) => api.get(`/users/${userId}/friends`),
  sendFriendRequest: (friendId) => friendsAPI.sendRequest(friendId),
  removeFriend: (friendId) => friendsAPI.removeFriend(friendId),
};

export const activityAPI = {
   getGlobalFeed: () => api.get('/activity/global'),
  getLocalFeed: () => api.get('/activity/local'),
  getUserActivity: (userId) => api.get(`/users/${userId}/activity`),
  getProjectActivity: (projectId) => api.get(`/projects/${projectId}/activity`),
  create: (activityData) => api.post('/activity', activityData),
};

// frontend/src/services/api.js
export const searchAPI = {
  searchAll: (query) => api.get(`/api/search/all?q=${encodeURIComponent(query)}`),
  searchUsers: (query) => api.get(`/api/search/users?q=${encodeURIComponent(query)}`),
  searchProjects: (query) => api.get(`/api/search/projects?q=${encodeURIComponent(query)}`),
  searchByTag: (tag) => api.get(`/api/search/tags?tag=${encodeURIComponent(tag)}`),
  general: (query) => api.get(`/search/all?q=${encodeURIComponent(query)}`),
  searchUsers: (query) => api.get(`/search/users?q=${encodeURIComponent(query)}`),
  searchProjects: (query) => api.get(`/search/projects?q=${encodeURIComponent(query)}`),
};

export default api;