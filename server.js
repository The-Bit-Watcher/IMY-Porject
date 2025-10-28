const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const path = require('path');
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

const uri = process.env.MONGODB_URI 
let db;
let client;

// ========== MIDDLEWARE CONFIGURATION ==========
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cookie'],
  exposedHeaders: ['Set-Cookie']
}));

app.use(session({
  secret: 'codecollab-secret-key',
  resave: true,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  },
  name: 'connect.sid',
  store: new (require('express-session').MemoryStore)()
}));

// Session debug middleware
app.use((req, res, next) => {
  console.log('🔐 SESSION DEBUG MIDDLEWARE:');
  console.log('  - Path:', req.path);
  console.log('  - Method:', req.method);
  console.log('  - Session ID:', req.sessionID);
  console.log('  - Session userId:', req.session.userId);
  console.log('  - Session exists:', !!req.session);
  console.log('  - Cookies present:', !!req.headers.cookie);
  console.log('  - Has connect.sid cookie:', req.headers.cookie && req.headers.cookie.includes('connect.sid'));
  
  if (req.headers.cookie) {
    console.log('  - All cookies:', req.headers.cookie);
  }
  
  next();
});

// Session restoration middleware
app.use(async (req, res, next) => {
  if (req.path === '/api/auth/login' || req.path === '/api/auth/signup') {
    return next();
  }
  
  if (!req.session.userId && req.headers['x-user-id']) {
    console.log('🔄 Attempting to restore session from header');
    const userId = req.headers['x-user-id'];
    
    try {
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { _id: 1 } }
      );
      
      if (user) {
        req.session.userId = userId;
        console.log('✅ Session restored for user:', userId);
      }
    } catch (error) {
      console.error('❌ Error restoring session:', error);
    }
  }
  
  next();
});

// Authentication middleware
function requireAuth(req, res, next){
  console.log('🔐 Auth check - Session:', req.session);
  console.log('🔐 Auth check - UserId in session:', req.session.userId);
  console.log('🔐 Auth check - Headers:', req.headers);
  
  if (!req.session.userId){
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  next();
}

// Helper function to enrich activities
async function enrichActivities(db, activities) {
  const userIds = [...new Set(activities.map(a => a.userId?.toString()))];
  const projectIds = [...new Set(
    activities.filter(a => a.projectId).map(a => a.projectId.toString())
  )];

  const users = await db.collection('users')
    .find({ _id: { $in: userIds.map(id => new ObjectId(id)) } })
    .toArray();

  const projects = await db.collection('projects')
    .find({ _id: { $in: projectIds.map(id => new ObjectId(id)) } })
    .toArray();

  const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u]));
  const projectMap = Object.fromEntries(projects.map(p => [p._id.toString(), p]));

  return activities.map(a => ({
    id: a._id,
    action: a.action || "checked in",
    message: a.message || "",
    timestamp: a.timestamp,
    user: {
      id: a.userId,
      name: userMap[a.userId?.toString()]?.name || "Unknown User",
      avatar: userMap[a.userId?.toString()]?.profilePic || "👤"
    },
    project: {
      id: a.projectId,
      name: projectMap[a.projectId?.toString()]?.name || "Unknown Project",
      image: projectMap[a.projectId?.toString()]?.image || "📁"
    },
    downloads: a.downloads || 0,
    likes: a.likes || 0
  }));
}

// ========== AUTHENTICATION ROUTES ==========

app.post('/api/auth/login', async (req, res) => {
  try{
    const {email, password} = req.body;

    if (!email || !password){
      return res.status(400).json({
        success: false,
        message: "Email and Password required"
      });
    }

    const user = await db.collection('users').findOne({email, password});

    if (user){
      req.session.userId = user._id.toString();
      console.log('🔑 Login successful - Setting session userId:', req.session.userId);

      res.json({
        success: true,
        message: "Login success",
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          profilePic: user.profilePic
        }
      });
    } else{
      res.status(401).json({
        success: false, 
        message: "Invalid email or password"
      });
    }
  }catch (error){
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        message: 'Email, password and name are required'
      });
    }

    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User already exists with this email'
      });
    }

    const newUser = {
      email,
      password,
      name,
      profilePic: '',
      friends: [],
      friendRequests: [],
      sentFriendRequests: [],
      createdAt: new Date(),
      isAdmin: false,
      isVerified: false,
      verificationRequested: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('users').insertOne(newUser);
    req.session.userId = result.insertedId.toString();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: result.insertedId,
        email: newUser.email,
        name: newUser.name,
        profilePic: newUser.profilePic
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error during signup"
    });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ========== USER MANAGEMENT ROUTES ==========

app.get('/api/users/me', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    
    console.log('🔍 GET /api/users/me - Session userId:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated"
      });
    }

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) }, 
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    console.log('✅ GET /api/users/me - User found:', user.name);

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profilePic: user.profilePic || '',
        bio: user.bio || '',
        skills: user.skills || [],
        location: user.location || '',
        website: user.website || '',
        createdAt: user.createdAt,
        friends: user.friends || [],
        updatedAt: user.updatedAt || user.createdAt
      }
    });
  } catch (error) {
    console.error("❌ Error in GET /api/users/me:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.put('/api/users/me', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const updateData = req.body;

    console.log('🔐 Session userId:', userId);
    console.log('📝 Update data received:', updateData);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated - no session found"
      });
    }

    // Remove fields that shouldn't be updated
    delete updateData._id;
    delete updateData.password;
    delete updateData.isAdmin;
    delete updateData.email;
    delete updateData.createdAt;

    // Add updatedAt timestamp
    updateData.updatedAt = new Date();

    // Format skills properly if it's a string
    if (typeof updateData.skills === 'string') {
      updateData.skills = updateData.skills.split(',').map(skill => skill.trim()).filter(skill => skill);
    }

    console.log('🔄 Updating user with data:', updateData);

    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { $set: updateData }
    );

    console.log('📊 MongoDB result:', result);

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or no changes made"
      });
    }

    const updatedUser = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { password: 0 } }
    );

    console.log('✅ Profile updated successfully for user:', updatedUser._id);

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        profilePic: updatedUser.profilePic || '',
        bio: updatedUser.bio || '',
        skills: updatedUser.skills || [],
        location: updatedUser.location || '',
        website: updatedUser.website || '',
        createdAt: updatedUser.createdAt,
        friends: updatedUser.friends || [],
        updatedAt: updatedUser.updatedAt
      }
    });
  } catch (error) {
    console.error("❌ Error in /api/users/me PUT:", error);
    res.status(500).json({
      success: false,
      message: "Server error during update: " + error.message
    });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    
    if (!ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format"
      });
    }

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) }, 
      { projection: { password: 0 } }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        profilePic: user.profilePic || '',
        bio: user.bio || '',
        skills: user.skills || [],
        location: user.location || '',
        website: user.website || '',
        createdAt: user.createdAt,
        friends: user.friends || [],
        updatedAt: user.updatedAt || user.createdAt
      }
    });
  } catch (error) {
    console.error("Error in /api/users/:id:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.get('/api/users/bulk', async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.status(400).json({
        success: false,
        message: "User IDs are required"
      });
    }

    const userIds = Array.isArray(ids) ? ids : ids.split(',');
    const validIds = userIds.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));

    const users = await db.collection('users')
      .find({ _id: { $in: validIds } })
      .project({ password: 0 })
      .toArray();

    res.json({
      success: true,
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        profilePic: user.profilePic,
        bio: user.bio || '',
        skills: user.skills || [],
        location: user.location || '',
        website: user.website || '',
        createdAt: user.createdAt,
        friends: user.friends || []
      }))
    });
  } catch (error) {
    console.error("Error in /api/users/bulk:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.get('/api/users/:userId/friends', requireAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const user = await db.collection('users').findOne(
      {_id: new ObjectId(userId)},
      {projection: {friends: 1}}
    );
    
    const friendIds = user?.friends || [];
    const friends = await db.collection('users').find(
      {_id: {$in: friendIds}},
      {projection: {password: 0}}
    ).toArray();

    res.json({
      success: true,
      friends
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.get('/api/users/:userId/projects', requireAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const projects = await db.collection('projects').find({
      $or: [
        {owner: new ObjectId(userId)},
        {members: new ObjectId(userId)}
      ]
    }).toArray();

    res.json({
      success: true,
      projects
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.get('/api/users/:userId/languages', async (req, res) => {
  try {
    res.json({
      success: true,
      languages: []
    });
  } catch (error) {
    console.error("Error in /api/users/:userId/languages:", error);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.delete('/api/users/:id', requireAuth, async (req, res) => {
  try{
    const userId = req.params.id;

    if (userId !== req.session.userId){
      return res.status(403).json({
        success: false, 
        message: "Not authorized to delete"
      });
    }

    const result = await db.collection('users').deleteOne(
      { _id: new ObjectId(userId) }
    );

    if (result.deletedCount === 0){
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    req.session.destroy();
    res.json({
      success: true, 
      message: "User deleted successfully"
    });
  }catch (error){
    res.status(500).json({
      success: false, 
      message: "Server error"
    });
  }
});

// Simple profile update endpoint
app.put('/api/users/update-profile', async (req, res) => {
  try {
    const { userId, updateData } = req.body;
    
    console.log('🔄 Simple profile update request');
    console.log('👤 User ID from request:', userId);
    console.log('📝 Update data:', updateData);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    if (!updateData || !updateData.name) {
      return res.status(400).json({
        success: false,
        message: "Name is required"
      });
    }

    // Remove any protected fields
    const cleanUpdateData = { ...updateData };
    delete cleanUpdateData._id;
    delete cleanUpdateData.password;
    delete cleanUpdateData.isAdmin;
    delete cleanUpdateData.email;

    // Add updatedAt timestamp
    cleanUpdateData.updatedAt = new Date();

    // Format skills properly
    if (cleanUpdateData.skills && typeof cleanUpdateData.skills === 'string') {
      cleanUpdateData.skills = cleanUpdateData.skills.split(',')
        .map(skill => skill.trim())
        .filter(skill => skill);
    }

    console.log('💾 Updating user in database...');

    const result = await db.collection('users').updateOne(
      { _id: new ObjectId(String(userId)) },
      { $set: cleanUpdateData }
    );

    console.log('📊 Database update result:', result);

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or no changes made"
      });
    }

    // Get the updated user
    const updatedUser = await db.collection('users').findOne(
      { _id: new ObjectId(String(userId)) },
      { projection: { password: 0 } }
    );

    console.log('✅ Profile updated successfully');

    res.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        profilePic: updatedUser.profilePic || '',
        bio: updatedUser.bio || '',
        skills: updatedUser.skills || [],
        location: updatedUser.location || '',
        website: updatedUser.website || '',
        createdAt: updatedUser.createdAt,
        friends: updatedUser.friends || [],
        updatedAt: updatedUser.updatedAt
      }
    });

  } catch (error) {
    console.error("❌ Error updating profile:", error);
    res.status(500).json({
      success: false,
      message: "Server error during update: " + error.message
    });
  }
});

// Add this comprehensive debug endpoint to server.js
app.get('/api/debug/local-feed-issues', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userObjectId = new ObjectId(userId);

    // Get current user with friends
    const currentUser = await db.collection('users').findOne(
      { _id: userObjectId },
      { projection: { friends: 1, name: 1 } }
    );

    console.log('🔍 DEBUG: Current user friends:', currentUser.friends);

    if (!currentUser.friends || currentUser.friends.length === 0) {
      return res.json({
        success: true,
        message: "No friends found",
        issues: ["No friends in friends array"]
      });
    }

    const friendId = currentUser.friends[0];
    console.log('🔍 DEBUG: First friend ID:', friendId);

    // Check if friend exists
    const friend = await db.collection('users').findOne(
      { _id: new ObjectId(friendId) },
      { projection: { name: 1, friends: 1 } }
    );

    if (!friend) {
      return res.json({
        success: true,
        message: "Friend not found in database",
        issues: ["Friend ID exists but user not found in database"]
      });
    }

    console.log('🔍 DEBUG: Friend found:', friend.name);

    // Check if friendship is mutual
    const isMutual = friend.friends && friend.friends.some(f => f.toString() === userId);
    console.log('🔍 DEBUG: Mutual friendship:', isMutual);

    // Get friend's projects
    const friendProjects = await db.collection('projects').find({
      $or: [
        { owner: new ObjectId(friendId) },
        { members: new ObjectId(friendId) }
      ]
    }).toArray();

    console.log('🔍 DEBUG: Friend projects count:', friendProjects.length);
    friendProjects.forEach(p => {
      console.log(`🔍 DEBUG: Friend project: ${p.name}, Owner: ${p.owner}`);
    });

    // Get activities from friend's projects
    const friendActivities = await db.collection('checkins').find({
      projectId: { $in: friendProjects.map(p => p._id) }
    }).toArray();

    console.log('🔍 DEBUG: Friend activities count:', friendActivities.length);
    friendActivities.forEach(a => {
      console.log(`🔍 DEBUG: Friend activity: ${a.message}, Project: ${a.projectId}`);
    });

    // Check what the local feed query would return
    const relevantUserIds = [userObjectId, new ObjectId(friendId)];
    const relevantProjects = await db.collection('projects').find({
      $or: [
        { owner: { $in: relevantUserIds } },
        { members: { $in: relevantUserIds } }
      ]
    }).toArray();

    const relevantActivities = await db.collection('checkins').find({
      projectId: { $in: relevantProjects.map(p => p._id) }
    }).toArray();

    res.json({
      success: true,
      debug: {
        currentUser: currentUser.name,
        friend: friend.name,
        friendId: friendId.toString(),
        isMutualFriendship: isMutual,
        friendProjects: friendProjects.map(p => ({
          name: p.name,
          owner: p.owner.toString(),
          hasFiles: !!(p.files && p.files.length > 0)
        })),
        friendActivities: friendActivities.map(a => ({
          message: a.message,
          projectId: a.projectId.toString(),
          userId: a.userId.toString()
        })),
        localFeedStats: {
          relevantProjects: relevantProjects.length,
          relevantActivities: relevantActivities.length,
          currentUserProjects: relevantProjects.filter(p => p.owner.toString() === userId).length,
          friendProjects: relevantProjects.filter(p => p.owner.toString() === friendId.toString()).length
        }
      },
      issues: !isMutual ? ["Friendship is not mutual"] : [],
      suggestions: !isMutual ? [
        "The friend needs to add you back as a friend for their activities to appear in your local feed"
      ] : []
    });

  } catch (error) {
    console.error('❌ Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ========== FRIEND SYSTEM ROUTES ==========

// In /api/friends/request endpoint, ensure mutual friendship:
app.post('/api/friends/request', requireAuth, async (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.session.userId;

    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: "Friend ID is required"
      });
    }

    if (friendId === userId) {
      return res.status(400).json({
        success: false,
        message: "You cannot send a friend request to yourself"
      });
    }

    // Check if users exist
    const [user, friend] = await Promise.all([
      db.collection('users').findOne({ _id: new ObjectId(userId) }),
      db.collection('users').findOne({ _id: new ObjectId(friendId) })
    ]);

    if (!user || !friend) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if already friends
    if (user.friends && user.friends.some(f => f.toString() === friendId)) {
      return res.status(400).json({
        success: false,
        message: "You are already friends with this user"
      });
    }

    // Check if request already sent
    if (user.sentFriendRequests && user.sentFriendRequests.some(req => req.toString() === friendId)) {
      return res.status(400).json({
        success: false,
        message: "Friend request already sent"
      });
    }

    // Check if you have a pending request from this user
    if (user.friendRequests && user.friendRequests.some(req => req.toString() === friendId)) {
      return res.status(400).json({
        success: false,
        message: "This user has already sent you a friend request. Please check your incoming requests."
      });
    }

    // Add to user's sent requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $addToSet: { sentFriendRequests: new ObjectId(friendId) },
        $set: { updatedAt: new Date() }
      }
    );

    // Add to friend's incoming requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(friendId) },
      { 
        $addToSet: { friendRequests: new ObjectId(userId) },
        $set: { updatedAt: new Date() }
      }
    );

    console.log(`📤 Friend request sent: ${userId} -> ${friendId}`);

    res.json({
      success: true,
      message: 'Friend request sent successfully'
    });
  } catch (error) {
    console.error("Error sending friend request:", error);
    return res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

app.post('/api/friends/accept', requireAuth, async (req, res) => {
  try {
    const { requesterId } = req.body;
    const userId = req.session.userId;

    if (!requesterId) {
      return res.status(400).json({
        success: false,
        message: "Requester ID is required"
      });
    }

    // Get current user
    const user = await db.collection('users').findOne({ _id: new ObjectId(userId) });

    // Check if request exists
    if (!user.friendRequests || !user.friendRequests.some(req => req.toString() === requesterId)) {
      return res.status(404).json({
        success: false,
        message: "Friend request not found"
      });
    }

    // Remove from friend requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $pull: { friendRequests: new ObjectId(requesterId) },
        $addToSet: { friends: new ObjectId(requesterId) },
        $set: { updatedAt: new Date() }
      }
    );

    // Remove from requester's sent requests and add to friends
    await db.collection('users').updateOne(
      { _id: new ObjectId(requesterId) },
      { 
        $pull: { sentFriendRequests: new ObjectId(userId) },
        $addToSet: { friends: new ObjectId(userId) },
        $set: { updatedAt: new Date() }
      }
    );

    console.log(`✅ Friend request accepted: ${requesterId} <-> ${userId}`);

    res.json({
      success: true,
      message: 'Friend request accepted successfully'
    });
  } catch (error) {
    console.error("Error accepting friend request:", error);
    return res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// Decline friend request
app.post('/api/friends/decline', requireAuth, async (req, res) => {
  try {
    const { requesterId } = req.body;
    const userId = req.session.userId;

    if (!requesterId) {
      return res.status(400).json({
        success: false,
        message: "Requester ID is required"
      });
    }

    // Remove from friend requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $pull: { friendRequests: new ObjectId(requesterId) },
        $set: { updatedAt: new Date() }
      }
    );

    // Remove from requester's sent requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(requesterId) },
      { 
        $pull: { sentFriendRequests: new ObjectId(userId) },
        $set: { updatedAt: new Date() }
      }
    );

    console.log(`❌ Friend request declined: ${requesterId} -> ${userId}`);

    res.json({
      success: true,
      message: 'Friend request declined successfully'
    });
  } catch (error) {
    console.error("Error declining friend request:", error);
    return res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// Cancel sent friend request
app.post('/api/friends/cancel', requireAuth, async (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.session.userId;

    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: "Friend ID is required"
      });
    }

    // Remove from user's sent requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $pull: { sentFriendRequests: new ObjectId(friendId) },
        $set: { updatedAt: new Date() }
      }
    );

    // Remove from friend's incoming requests
    await db.collection('users').updateOne(
      { _id: new ObjectId(friendId) },
      { 
        $pull: { friendRequests: new ObjectId(userId) },
        $set: { updatedAt: new Date() }
      }
    );

    console.log(`🚫 Friend request cancelled: ${userId} -> ${friendId}`);

    res.json({
      success: true,
      message: 'Friend request cancelled successfully'
    });
  } catch (error) {
    console.error("Error cancelling friend request:", error);
    return res.status(500).json({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
});

// Get friend requests (incoming)
app.get('/api/friends/requests', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { friendRequests: 1 } }
    );

    const requestIds = user?.friendRequests || [];
    
    // Get user details for each request
    const requests = await Promise.all(
      requestIds.map(async (requesterId) => {
        const requester = await db.collection('users').findOne(
          { _id: requesterId },
          { projection: { name: 1, email: 1, profilePic: 1, bio: 1 } }
        );
        return {
          id: requesterId,
          name: requester?.name || 'Unknown User',
          email: requester?.email,
          profilePic: requester?.profilePic,
          bio: requester?.bio
        };
      })
    );

    res.json({
      success: true,
      requests: requests.filter(req => req.name !== 'Unknown User')
    });
  } catch (error) {
    console.error("Error getting friend requests:", error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get sent friend requests
app.get('/api/friends/sent-requests', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { sentFriendRequests: 1 } }
    );

    const sentRequestIds = user?.sentFriendRequests || [];
    
    // Get user details for each sent request
    const sentRequests = await Promise.all(
      sentRequestIds.map(async (friendId) => {
        const friend = await db.collection('users').findOne(
          { _id: friendId },
          { projection: { name: 1, email: 1, profilePic: 1, bio: 1 } }
        );
        return {
          id: friendId,
          name: friend?.name || 'Unknown User',
          email: friend?.email,
          profilePic: friend?.profilePic,
          bio: friend?.bio
        };
      })
    );

    res.json({
      success: true,
      sentRequests: sentRequests.filter(req => req.name !== 'Unknown User')
    });
  } catch (error) {
    console.error("Error getting sent friend requests:", error);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


// app.delete('/api/friends/remove', async (req, res) => {
//   try {
//     const { userId, friendId } = req.body;

//     console.log('🗑️ Simple friend removal:', { userId, friendId });

//     if (!userId || !friendId) {
//       return res.status(400).json({
//         success: false,
//         message: "User ID and Friend ID are required"
//       });
//     }

//     const userResult = await db.collection('users').updateOne(
//       { _id: new ObjectId(userId) },
//       { $pull: { friends: new ObjectId(friendId) } }
//     );

//     console.log('📊 User update result:', userResult);

//     const friendResult = await db.collection('users').updateOne(
//       { _id: new ObjectId(friendId) },
//       { $pull: { friends: new ObjectId(userId) } }
//     );

//     console.log('📊 Friend update result:', friendResult);

//     res.json({
//       success: true,
//       message: "Friend removed successfully"
//     });

//   } catch (error) {
//     console.error("❌ Error removing friend:", error);
//     res.status(500).json({
//       success: false,
//       message: "Server error during friend removal: " + error.message
//     });
//   }
// });

app.delete('/api/friends/remove', requireAuth, async (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.session.userId;

    console.log('🗑️ Removing friend:', { userId, friendId });

    if (!friendId) {
      return res.status(400).json({
        success: false,
        message: "Friend ID is required"
      });
    }

    // Get users before removal for debugging
    const [userBefore, friendBefore] = await Promise.all([
      db.collection('users').findOne({ _id: new ObjectId(userId) }),
      db.collection('users').findOne({ _id: new ObjectId(friendId) })
    ]);

    console.log('📊 Before removal - User friends:', userBefore?.friends?.map(f => f.toString()));
    console.log('📊 Before removal - Friend friends:', friendBefore?.friends?.map(f => f.toString()));

    // Remove friend from current user's friends
    const userResult = await db.collection('users').updateOne(
      { _id: new ObjectId(userId) },
      { 
        $pull: { friends: new ObjectId(friendId) },
        $set: { updatedAt: new Date() }
      }
    );

    // Remove current user from friend's friends
    const friendResult = await db.collection('users').updateOne(
      { _id: new ObjectId(friendId) },
      { 
        $pull: { friends: new ObjectId(userId) },
        $set: { updatedAt: new Date() }
      }
    );

    console.log('📊 Remove results:', { 
      userModified: userResult.modifiedCount,
      friendModified: friendResult.modifiedCount 
    });

    // Get users after removal for debugging
    const [userAfter, friendAfter] = await Promise.all([
      db.collection('users').findOne({ _id: new ObjectId(userId) }),
      db.collection('users').findOne({ _id: new ObjectId(friendId) })
    ]);

    console.log('📊 After removal - User friends:', userAfter?.friends?.map(f => f.toString()));
    console.log('📊 After removal - Friend friends:', friendAfter?.friends?.map(f => f.toString()));

    res.json({
      success: true,
      message: "Friend removed successfully",
      debug: {
        userModified: userResult.modifiedCount,
        friendModified: friendResult.modifiedCount,
        userFriendsAfter: userAfter?.friends?.length || 0,
        friendFriendsAfter: friendAfter?.friends?.length || 0
      }
    });

  } catch (error) {
    console.error("❌ Error removing friend:", error);
    res.status(500).json({
      success: false,
      message: "Server error during friend removal: " + error.message
    });
  }
});

// ========== PROJECT MANAGEMENT ROUTES ==========

app.get('/api/projects', async (req, res) => {
  try{
    const projects = await db.collection('projects').find().toArray();
    res.json({
      success: true,
      projects
    });
  }catch (error){
    res.status(500).json({
      success: false,
      message: 'Server error'
    })
  }
});

app.post('/api/projects', requireAuth, async (req, res) => {
  try {
    const { name, description, hashtags, files } = req.body;
    const userId = req.session.userId;

    console.log('🆕 Creating new project:', { name, description, hashtags, files });

    if (!name || !description) {
      return res.status(400).json({
        success: false,
        message: "Project name and description are required"
      });
    }

    const newProject = {
      name: name.trim(),
      description: description.trim(),
      hashtags: hashtags || [],
      files: files || [],
      owner: new ObjectId(String(userId)),
      members: [new ObjectId(String(userId))],
      isCheckedOut: false,
      checkedOutBy: null,
      version: '1.0.0',
      checkins: [],
      image: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    console.log('💾 Saving project to database...');
    const result = await db.collection('projects').insertOne(newProject);

    // Create checkin activity for project creation
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: result.insertedId,
      action: "checked in",
      message: `Created new project: ${name}`,
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    await db.collection('checkins').insertOne(checkinData);
    console.log('✅ Project created and checkin activity recorded');

    res.status(201).json({
      success: true,
      message: "Project created successfully",
      project: {
        id: result.insertedId,
        ...newProject
      }
    });
  } catch (error) {
    console.error("❌ Error creating project:", error);
    res.status(500).json({
      success: false,
      message: "Server error during project creation: " + error.message
    });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  try{
    const projectId = req.params.id;
    const project = await db.collection('projects').findOne({
      _id : new ObjectId(projectId)
    });

    if (!project){
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({
      success: true, 
      project
    });
  }catch (error){
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.put('/api/projects/:projectId', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = req.session.userId;
    const { name, description, hashtags, version } = req.body;

    console.log('✏️ Updating project:', projectId);

    const project = await db.collection('projects').findOne({
      _id: new ObjectId(projectId),
      $or: [
        { owner: new ObjectId(String(userId)) },
        { members: new ObjectId(String(userId)) }
      ]
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or you don't have permission to update it"
      });
    }

    const updateData = {
      updatedAt: new Date()
    };

    if (name) updateData.name = name.trim();
    if (description) updateData.description = description.trim();
    if (hashtags) updateData.hashtags = Array.isArray(hashtags) ? hashtags : hashtags.split(',').map(tag => tag.trim()).filter(tag => tag);
    if (version) updateData.version = version;

    const result = await db.collection('projects').updateOne(
      { _id: new ObjectId(projectId) },
      { $set: updateData }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Project not found or no changes made"
      });
    }

    // Create checkin activity for project update
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: new ObjectId(projectId),
      action: "updated",
      message: `Updated project details${version ? ` to version ${version}` : ''}`,
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    await db.collection('checkins').insertOne(checkinData);
    console.log('✅ Project updated and checkin activity recorded');

    res.json({
      success: true,
      message: "Project updated successfully"
    });
  } catch (error) {
    console.error("❌ Error updating project:", error);
    res.status(500).json({
      success: false,
      message: "Server error during project update: " + error.message
    });
  }
});

app.delete('/api/projects/:id', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.id;
    const userId = req.session.userId;

    console.log('🗑️ Deleting project:', projectId);

    const project = await db.collection('projects').findOne({
      _id: new ObjectId(projectId),
      owner: new ObjectId(String(userId))
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or you don't have permission to delete it"
      });
    }

    // Create checkin activity for project deletion
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: new ObjectId(projectId),
      action: "deleted",
      message: `Deleted project: ${project.name}`,
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    await db.collection('checkins').insertOne(checkinData);

    const result = await db.collection('projects').deleteOne({
      _id: new ObjectId(projectId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    console.log('✅ Project deleted and checkin activity recorded');

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    console.error("❌ Error deleting project:", error);
    res.status(500).json({
      success: false,
      message: 'Server error during project deletion'
    });
  }
});

// ========== PROJECT FILE MANAGEMENT ROUTES ==========

app.post('/api/projects/:projectId/files', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = req.session.userId;
    const { files } = req.body;

    console.log('📁 Adding files to project:', projectId);
    console.log('📄 Files to add:', files?.length || 0);

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files provided"
      });
    }

    for (const file of files) {
      if (!file.name || !file.type || !file.content) {
        return res.status(400).json({
          success: false,
          message: "Each file must have name, type, and content properties"
        });
      }

      const base64Size = (file.content.length * 3) / 4;
      if (base64Size > 10 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          message: `File ${file.name} exceeds 10MB size limit`
        });
      }
    }

    const fileMetadata = files.map(file => ({
      name: file.name,
      type: file.type,
      size: file.size || Buffer.from(file.content, 'base64').length,
      content: file.content,
      uploadedBy: new ObjectId(String(userId)),
      uploadDate: new Date()
    }));

    const result = await db.collection('projects').updateOne(
      { _id: new ObjectId(projectId) },
      { 
        $push: { files: { $each: fileMetadata } },
        $set: { updatedAt: new Date() }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }

    // Create checkin activity for file upload
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: new ObjectId(projectId),
      action: "updated",
      message: `Uploaded ${files.length} file(s): ${files.map(f => f.name).join(', ')}`,
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    await db.collection('checkins').insertOne(checkinData);
    console.log('✅ Files added and checkin activity recorded');

    res.json({
      success: true,
      message: "Files added successfully",
      files: fileMetadata.map(f => ({ name: f.name, type: f.type, size: f.size }))
    });
  } catch (error) {
    console.error("❌ Error adding files:", error);
    res.status(500).json({
      success: false,
      message: "Server error during file addition: " + error.message
    });
  }
});

app.get('/api/projects/:projectId/files/:fileIndex', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const fileIndex = parseInt(req.params.fileIndex);
    
    console.log('📥 Getting file:', { projectId, fileIndex });

    const project = await db.collection('projects').findOne(
      { _id: new ObjectId(projectId) },
      { projection: { files: 1 } }
    );

    if (!project || !project.files || !project.files[fileIndex]) {
      return res.status(404).json({
        success: false,
        message: "File not found"
      });
    }

    const file = project.files[fileIndex];
    
    res.json({
      success: true,
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
        content: file.content,
        uploadDate: file.uploadDate
      }
    });
  } catch (error) {
    console.error("❌ Error getting file:", error);
    res.status(500).json({
      success: false,
      message: "Server error getting file"
    });
  }
});

// ========== PROJECT IMAGE ROUTES ==========

app.post('/api/projects/:projectId/image', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = req.session.userId;
    const { image } = req.body;

    console.log('🖼️ Uploading project image:', projectId);

    if (!image) {
      return res.status(400).json({
        success: false,
        message: "No image provided"
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const fileSizeInMB = buffer.length / (1024 * 1024);

    console.log(`📊 Image size: ${fileSizeInMB.toFixed(2)}MB`);

    if (fileSizeInMB > 2) {
      return res.status(400).json({
        success: false,
        message: "Image exceeds 2MB size limit. Please use a smaller image."
      });
    }

    if (!image.startsWith('data:image/')) {
      return res.status(400).json({
        success: false,
        message: "Invalid image format"
      });
    }

    const result = await db.collection('projects').updateOne(
      { _id: new ObjectId(projectId) },
      { 
        $set: { 
          image: {
            content: image,
            uploadDate: new Date(),
            size: fileSizeInMB
          },
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }

    // Create checkin activity for image upload
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: new ObjectId(projectId),
      action: "updated",
      message: "Updated project image",
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    await db.collection('checkins').insertOne(checkinData);
    console.log('✅ Project image uploaded and checkin activity recorded');

    res.json({
      success: true,
      message: "Project image uploaded successfully"
    });
  } catch (error) {
    console.error("❌ Error uploading project image:", error);
    res.status(500).json({
      success: false,
      message: "Server error during image upload: " + error.message
    });
  }
});

// ========== PROJECT VERSION CONTROL ROUTES ==========

app.post('/api/projects/:projectId/checkout', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = req.session.userId;

    console.log('🔒 Checking out project:', projectId);

    const project = await db.collection('projects').findOne({
      _id: new ObjectId(projectId),
      $or: [
        { owner: new ObjectId(String(userId)) },
        { members: new ObjectId(String(userId)) }
      ]
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or you don't have permission to check it out"
      });
    }

    if (project.isCheckedOut && project.checkedOutBy.toString() !== userId) {
      return res.status(409).json({
        success: false,
        message: "Project is already checked out by another user"
      });
    }

    const newCheckoutStatus = !project.isCheckedOut;
    const checkoutUser = newCheckoutStatus ? new ObjectId(String(userId)) : null;

    const result = await db.collection('projects').updateOne(
      { _id: new ObjectId(projectId) },
      { 
        $set: { 
          isCheckedOut: newCheckoutStatus,
          checkedOutBy: checkoutUser,
          updatedAt: new Date()
        }
      }
    );

    // Create checkin activity for checkout/checkin
    const action = newCheckoutStatus ? "checked out" : "checked in";
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: new ObjectId(projectId),
      action: action,
      message: `${action} project for editing`,
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    await db.collection('checkins').insertOne(checkinData);
    console.log(`✅ Project ${action} and checkin activity recorded`);

    res.json({
      success: true,
      message: `Project ${action} successfully`,
      isCheckedOut: newCheckoutStatus
    });
  } catch (error) {
    console.error("❌ Error during checkout:", error);
    res.status(500).json({
      success: false,
      message: "Server error during checkout: " + error.message
    });
  }
});

// ========== PROJECT COMMENTS ROUTES ==========

app.post('/api/projects/:projectId/comments', requireAuth, async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = req.session.userId;
    const { comment } = req.body;

    console.log('💬 Adding comment to project:', projectId);

    if (!comment || !comment.trim()) {
      return res.status(400).json({
        success: false,
        message: "Comment is required"
      });
    }

    const project = await db.collection('projects').findOne({
      _id: new ObjectId(projectId)
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found"
      });
    }

    // Create checkin activity for comment
    const checkinData = {
      userId: new ObjectId(String(userId)),
      projectId: new ObjectId(projectId),
      action: "commented",
      message: comment.trim(),
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };

    const result = await db.collection('checkins').insertOne(checkinData);
    console.log('✅ Comment added and checkin activity recorded');

    res.json({
      success: true,
      message: "Comment added successfully",
      comment: {
        id: result.insertedId,
        ...checkinData
      }
    });
  } catch (error) {
    console.error("❌ Error adding comment:", error);
    res.status(500).json({
      success: false,
      message: "Server error during comment addition: " + error.message
    });
  }
});

// ========== ACTIVITY FEED ROUTES ==========

// Get global file activities (all files from all projects)
app.get('/api/activity/global', async (req, res) => {
  try {
    console.log('🌍 Global file activity request');
    
    // Get all projects with their files
    const projects = await db.collection('projects')
      .find({ 
        'files.0': { $exists: true } // Only projects that have files
      })
      .project({
        name: 1,
        description: 1,
        image: 1,
        files: 1,
        owner: 1,
        createdAt: 1,
        updatedAt: 1
      })
      .sort({ updatedAt: -1 })
      .toArray();

    // Flatten all files with project context
    const allFiles = [];
    
    for (const project of projects) {
      if (project.files && project.files.length > 0) {
        // Get project owner info
        const owner = await db.collection('users').findOne(
          { _id: project.owner },
          { projection: { name: 1, profilePic: 1 } }
        );
        
       // In /api/activity/global endpoint, fix the file data:
project.files.forEach(file => {
  // Make sure file has a name
  const fileName = file.name || 'Unknown File';
  
  allFiles.push({
    _id: file._id || `${project._id}-${fileName}`,
    fileName: fileName, // Ensure this is never undefined
    fileType: file.type || 'unknown',
    fileSize: file.size || 0,
    uploadDate: file.uploadDate || project.updatedAt,
    projectId: project._id,
    projectName: project.name,
    projectDescription: project.description,
    projectImage: project.image,
    ownerName: owner?.name || 'Unknown User',
    ownerAvatar: owner?.profilePic,
    ownerId: owner?._id.toString() // Make sure this exists
  });
});
      }
    }
    
    // Sort by upload date (newest first)
    allFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    
    console.log(`📁 Found ${allFiles.length} files globally`);
    
    res.json({ 
      success: true, 
      files: allFiles.slice(0, 50) // Limit to 50 most recent
    });
    
  } catch (error) {
    console.error('❌ Error in global file activity:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get local activity (user's projects + friends' projects)
// app.get('/api/activity/local', async (req, res) => {
//   try {
//     console.log('🏠 Local activity request received');
//     console.log('🔐 Session userId:', req.session.userId);
//     console.log('📨 Headers userId:', req.headers['x-user-id']);
    
//     // Get user ID from session or headers
//     let userId = req.session.userId;
//     if (!userId && req.headers['x-user-id']) {
//       userId = req.headers['x-user-id'];
//       console.log('🔄 Using userId from headers:', userId);
//     }
    
//     // If no user ID, return empty results instead of 401
//     if (!userId) {
//       console.log('👤 No user ID found - returning empty local feed');
//       return res.json({ 
//         success: true, 
//         activities: [],
//         message: 'No user session found - showing empty local feed'
//       });
//     }

//     // Validate user ID format
//     if (!ObjectId.isValid(userId)) {
//       console.log('❌ Invalid user ID format:', userId);
//       return res.json({ 
//         success: true, 
//         activities: [],
//         message: 'Invalid user ID format'
//       });
//     }

//     const userObjectId = new ObjectId(userId);
//     console.log('👤 Processing local feed for user:', userId);

//     // Get user with friends
//     const user = await db.collection('users').findOne(
//       { _id: userObjectId },
//       { projection: { friends: 1, name: 1 } }
//     );
    
//     if (!user) {
//       console.log('❌ User not found in database:', userId);
//       return res.json({ 
//         success: true, 
//         activities: [],
//         message: 'User not found'
//       });
//     }

//     console.log('✅ User found:', user.name);
//     console.log('👥 User friends count:', user.friends ? user.friends.length : 0);

//     // Get all relevant user IDs (user + friends)
//     const friendIds = user.friends ? user.friends.map(friendId => {
//       try {
//         return new ObjectId(friendId);
//       } catch (e) {
//         console.log('❌ Invalid friend ID:', friendId);
//         return null;
//       }
//     }).filter(id => id !== null) : [];
    
//     const relevantUserIds = [userObjectId, ...friendIds];
    
//     console.log('📋 Relevant user IDs:', relevantUserIds.length);

//     // Get projects owned by user and friends
//     const projects = await db.collection('projects')
//       .find({
//         $or: [
//           { owner: { $in: relevantUserIds } },
//           { members: { $in: relevantUserIds } }
//         ]
//       })
//       .toArray();

//     console.log(`📁 Found ${projects.length} relevant projects`);

//     const projectIds = projects.map(project => project._id);
    
//     // Get activities for these projects
//     const activities = await db.collection('checkins')
//       .aggregate([
//         {
//           $match: {
//             projectId: { $in: projectIds }
//           }
//         },
//         {
//           $lookup: {
//             from: 'users',
//             localField: 'userId',
//             foreignField: '_id',
//             as: 'user'
//           }
//         },
//         {
//           $lookup: {
//             from: 'projects',
//             localField: 'projectId',
//             foreignField: '_id',
//             as: 'project'
//           }
//         },
//         {
//           $sort: { timestamp: -1 }
//         },
//         {
//           $limit: 50
//         },
//         {
//           $project: {
//             _id: 1,
//             message: 1,
//             action: 1,
//             timestamp: 1,
//             likes: 1,
//             downloads: 1,
//             files: 1,
//             'user._id': 1,
//             'user.name': 1,
//             'user.profilePic': 1,
//             'project._id': 1,
//             'project.name': 1,
//             'project.image': 1
//           }
//         }
//       ])
//       .toArray();

//     console.log(`📊 Local activities found: ${activities.length}`);

//     // Format the activities for frontend
//     const formattedActivities = activities.map(activity => ({
//       _id: activity._id,
//       message: activity.message,
//       action: activity.action,
//       timestamp: activity.timestamp,
//       likes: activity.likes || 0,
//       downloads: activity.downloads || 0,
//       files: activity.files || [],
//       userId: activity.user && activity.user[0] ? {
//         _id: activity.user[0]._id,
//         name: activity.user[0].name,
//         profilePic: activity.user[0].profilePic
//       } : null,
//       projectId: activity.project && activity.project[0] ? {
//         _id: activity.project[0]._id,
//         name: activity.project[0].name,
//         image: activity.project[0].image
//       } : null
//     }));

//     res.json({ 
//       success: true, 
//       activities: formattedActivities,
//       debug: {
//         userId,
//         userName: user.name,
//         friendCount: friendIds.length,
//         projectCount: projects.length,
//         activityCount: formattedActivities.length
//       }
//     });
    
//   } catch (error) {
//     console.error('❌ Error in local activity endpoint:', error);
//     res.status(500).json({ 
//       success: false, 
//       message: error.message 
//     });
//   }
// });

app.get('/api/activity/local', async (req, res) => {
  try {
    console.log('🏠 Local activity request received');
    console.log('🔐 Session userId:', req.session.userId);
    
    // Get user ID from session or headers
    let userId = req.session.userId;
    if (!userId && req.headers['x-user-id']) {
      userId = req.headers['x-user-id'];
      console.log('🔄 Using userId from headers:', userId);
    }
    
    if (!userId) {
      console.log('👤 No user ID found - returning empty local feed');
      return res.json({ 
        success: true, 
        activities: [],
        message: 'No user session found - showing empty local feed'
      });
    }

    // Validate user ID format
    if (!ObjectId.isValid(userId)) {
      console.log('❌ Invalid user ID format:', userId);
      return res.json({ 
        success: true, 
        activities: [],
        message: 'Invalid user ID format'
      });
    }

    const userObjectId = new ObjectId(userId);
    console.log('👤 Processing local feed for user:', userId);

    // Get user with friends - MORE DETAILED DEBUGGING
    const user = await db.collection('users').findOne(
      { _id: userObjectId },
      { projection: { friends: 1, name: 1, email: 1 } }
    );
    
    if (!user) {
      console.log('❌ User not found in database:', userId);
      return res.json({ 
        success: true, 
        activities: [],
        message: 'User not found'
      });
    }

    console.log('✅ User found:', user.name, user.email);
    console.log('👥 Raw friends array:', user.friends);
    console.log('👥 Friends count:', user.friends ? user.friends.length : 0);

    // Get all relevant user IDs (user + friends) with proper conversion
    const friendIds = user.friends ? user.friends.map(friendId => {
  try {
    return new ObjectId(friendId.toString());
  } catch (e) {
    console.log('❌ Invalid friend ID:', friendId);
    return null;
  }
}).filter(id => id !== null) : [];

// Only include mutual friends in relevantUserIds
const relevantUserIds = [userObjectId, ...friendIds];
    
    console.log('📋 Relevant user IDs count:', relevantUserIds.length);
    console.log('📋 Relevant user IDs:', relevantUserIds.map(id => id.toString()));

    // Get projects owned by user and friends - MORE DETAILED QUERY
    const projects = await db.collection('projects')
      .find({
        $or: [
          { owner: { $in: relevantUserIds } },
          { members: { $in: relevantUserIds } }
        ]
      })
      .toArray();

    console.log(`📁 Found ${projects.length} relevant projects`);
    
    // Log project details for debugging
    projects.forEach(project => {
      console.log(`📋 Project: ${project.name}, Owner: ${project.owner}, Members: ${project.members ? project.members.length : 0}`);
    });

    const projectIds = projects.map(project => project._id);
    
    console.log('📋 Project IDs for activity lookup:', projectIds.map(id => id.toString()));

    // Get activities for these projects
    const activities = await db.collection('checkins')
      .aggregate([
        {
          $match: {
            projectId: { $in: projectIds }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project'
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $limit: 50
        },
        {
          $project: {
            _id: 1,
            message: 1,
            action: 1,
            timestamp: 1,
            likes: 1,
            downloads: 1,
            files: 1,
            'user._id': 1,
            'user.name': 1,
            'user.profilePic': 1,
            'project._id': 1,
            'project.name': 1,
            'project.image': 1,
            'project.owner': 1
          }
        }
      ])
      .toArray();

    console.log(`📊 Local activities found: ${activities.length}`);

    // Format the activities for frontend
    const formattedActivities = activities.map(activity => ({
      _id: activity._id,
      message: activity.message,
      action: activity.action,
      timestamp: activity.timestamp,
      likes: activity.likes || 0,
      downloads: activity.downloads || 0,
      files: activity.files || [],
      userId: activity.user && activity.user[0] ? {
        _id: activity.user[0]._id,
        name: activity.user[0].name,
        profilePic: activity.user[0].profilePic
      } : null,
      projectId: activity.project && activity.project[0] ? {
        _id: activity.project[0]._id,
        name: activity.project[0].name,
        image: activity.project[0].image,
        owner: activity.project[0].owner // Include owner for debugging
      } : null
    }));

    res.json({ 
      success: true, 
      activities: formattedActivities,
      debug: {
        userId,
        userName: user.name,
        friendCount: friendIds.length,
        projectCount: projects.length,
        activityCount: formattedActivities.length,
        relevantUserIds: relevantUserIds.map(id => id.toString()),
        projectIds: projectIds.map(id => id.toString())
      }
    });
    
  } catch (error) {
    console.error('❌ Error in local activity endpoint:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Get activity for specific project
app.get('/api/projects/:projectId/activity', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    console.log('📋 Project activity request for:', projectId);
    
    const activities = await db.collection('checkins')
      .aggregate([
        {
          $match: {
            projectId: new ObjectId(projectId)
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $limit: 50
        },
        {
          $project: {
            _id: 1,
            message: 1,
            action: 1,
            timestamp: 1,
            likes: 1,
            downloads: 1,
            files: 1,
            'user._id': 1,
            'user.name': 1,
            'user.profilePic': 1
          }
        }
      ])
      .toArray();

    // Format the activities
    const formattedActivities = activities.map(activity => ({
      _id: activity._id,
      message: activity.message,
      action: activity.action,
      timestamp: activity.timestamp,
      likes: activity.likes || 0,
      downloads: activity.downloads || 0,
      files: activity.files || [],
      userId: activity.user && activity.user[0] ? {
        _id: activity.user[0]._id,
        name: activity.user[0].name,
        profilePic: activity.user[0].profilePic
      } : null
    }));

    res.json({ 
      success: true, 
      activities: formattedActivities 
    });
  } catch (error) {
    console.error('❌ Error in project activity endpoint:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Create new activity (for testing or when actions happen)
app.post('/api/activity', async (req, res) => {
  try {
    const { userId, projectId, message, files, type } = req.body;
    
    const newActivity = {
      userId: new ObjectId(String(userId)),
      projectId: projectId ? new ObjectId(String(projectId)) : null,
      message: message,
      files: files || [],
      type: type || 'general',
      timestamp: new Date(),
      likes: 0,
      downloads: 0
    };
    
    const result = await db.collection('checkins').insertOne(newActivity);
    
    // Get the created activity with populated data
    const createdActivity = await db.collection('checkins')
      .aggregate([
        {
          $match: { _id: result.insertedId }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project'
          }
        }
      ])
      .next();

    res.json({ 
      success: true, 
      activity: createdActivity 
    });
  } catch (error) {
    console.error('❌ Error creating activity:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

app.get('/api/activity/feed', async (req, res) => {
  try {
    const activities = await db.collection('checkins').find().sort({timestamp:-1}).toArray();
    res.json({
      success: true,
      activities
    });
  } catch(error) {
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

app.get('/api/users/:userId/activity', async (req, res) => {
  try {
    const userId = req.params.userId;
    const activities = await db.collection('checkins').find({
      userId: new ObjectId(userId)
    }).sort({timestamp: -1}).toArray();

    res.json({
      success: true,
      activities
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

app.post('/api/activity/:activityId/like', async (req, res) => {
  try {
    const activityId = req.params.activityId;
    const userId = req.session.userId;

    console.log('👍 Liking activity:', activityId);

    const activity = await db.collection('checkins').findOne({
      _id: new ObjectId(activityId)
    });

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: "Activity not found"
      });
    }

    const newLikes = (activity.likes || 0) + 1;

    const result = await db.collection('checkins').updateOne(
      { _id: new ObjectId(activityId) },
      { $set: { likes: newLikes } }
    );

    console.log('✅ Activity liked');

    res.json({
      success: true,
      message: "Activity liked successfully",
      likes: newLikes
    });
  } catch (error) {
    console.error("❌ Error liking activity:", error);
    res.status(500).json({
      success: false,
      message: "Server error during like operation"
    });
  }
});

// ========== SEARCH FUNCTIONALITY ROUTES ==========

// General search (users and projects)
app.get('/api/search/all', async (req, res) => {
  try {
    const { q: query } = req.query;
    
    console.log('🔍 Search request for:', query);
    
    if (!query) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    // Search users
    const users = await db.collection('users').find({
      $or: [
        { name: { $regex: query, $options: 'i' }},
        { email: { $regex: query, $options: 'i' }}
      ]
    }, { projection: { password: 0 } }).toArray();

    // Search projects
    const projects = await db.collection('projects').find({
      $or: [
        { name: { $regex: query, $options: 'i' }},
        { description: { $regex: query, $options: 'i' }},
        { hashtags: { $in: [new RegExp(query, 'i')] }}
      ]
    }).toArray();

    // Search activities/checkins
    const activities = await db.collection('checkins')
      .aggregate([
        {
          $match: {
            message: { $regex: query, $options: 'i' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project'
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $limit: 20
        }
      ])
      .toArray();

    console.log(`📊 Search results - Users: ${users.length}, Projects: ${projects.length}, Activities: ${activities.length}`);

    res.json({
      success: true,
      results: {
        users,
        projects,
        activities
      }
    });

  } catch (error) {
    console.error('❌ Error in general search:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during search'
    });
  }
});

// Add this route for dynamic activity types
app.get('/api/activity/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { sort } = req.query;
    
    console.log(`📊 Dynamic activity request: ${type}, sort: ${sort}`);
    
    if (type === 'global') {
      // Call your existing global logic
      const projects = await db.collection('projects')
        .find({ 'files.0': { $exists: true } })
        .project({ name: 1, description: 1, image: 1, files: 1, owner: 1, createdAt: 1, updatedAt: 1 })
        .sort({ updatedAt: -1 })
        .toArray();

      const allFiles = [];
      for (const project of projects) {
        if (project.files && project.files.length > 0) {
          const owner = await db.collection('users').findOne(
            { _id: project.owner },
            { projection: { name: 1, profilePic: 1 } }
          );
          
          project.files.forEach(file => {
            allFiles.push({
              _id: file._id || `${project._id}-${file.name}`,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
              uploadDate: file.uploadDate || project.updatedAt,
              projectId: project._id,
              projectName: project.name,
              projectDescription: project.description,
              projectImage: project.image,
              ownerName: owner?.name || 'Unknown User',
              ownerAvatar: owner?.profilePic
            });
          });
        }
      }
      
      allFiles.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
      
      res.json({ 
        success: true, 
        files: allFiles.slice(0, 50)
      });
      
    } else if (type === 'local') {
      // Call your existing local logic
      // ... copy the existing /api/activity/local logic here
      let userId = req.session.userId;
      if (!userId && req.headers['x-user-id']) {
        userId = req.headers['x-user-id'];
      }
      
      if (!userId) {
        return res.json({ 
          success: true, 
          activities: [],
          message: 'No user session found'
        });
      }
      
      // ... rest of your local activity logic
      
    } else {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity type. Use "global" or "local"'
      });
    }
  } catch (error) {
    console.error('❌ Error in dynamic activity endpoint:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

app.get('/api/activity/local-fixed', async (req, res) => {
  try {
    console.log('🏠 FIXED Local activity request received');
    
    let userId = req.session.userId;
    if (!userId && req.headers['x-user-id']) {
      userId = req.headers['x-user-id'];
    }
    
    if (!userId) {
      return res.json({ 
        success: true, 
        activities: [],
        message: 'No user session found'
      });
    }

    if (!ObjectId.isValid(userId)) {
      return res.json({ 
        success: true, 
        activities: [],
        message: 'Invalid user ID format'
      });
    }

    const userObjectId = new ObjectId(userId);

    // Get user with friends
    const user = await db.collection('users').findOne(
      { _id: userObjectId },
      { projection: { friends: 1, name: 1 } }
    );
    
    if (!user) {
      return res.json({ 
        success: true, 
        activities: [],
        message: 'User not found'
      });
    }

    // Get valid friend IDs
    const friendIds = user.friends ? user.friends.map(friendId => {
      try {
        return new ObjectId(friendId.toString());
      } catch (e) {
        return null;
      }
    }).filter(id => id !== null) : [];

    const relevantUserIds = [userObjectId, ...friendIds];

    console.log('👤 User:', userId);
    console.log('👥 Friend IDs:', friendIds.map(id => id.toString()));
    console.log('📋 All relevant user IDs:', relevantUserIds.map(id => id.toString()));

    // Get ALL projects from relevant users (both owned and where they're members)
    const projects = await db.collection('projects')
      .find({
        $or: [
          { owner: { $in: relevantUserIds } },
          { members: { $in: relevantUserIds } }
        ]
      })
      .toArray();

    console.log(`📁 Found ${projects.length} total relevant projects`);

    const projectIds = projects.map(project => project._id);
    
    console.log('🔍 Looking for activities in projects:', projectIds.map(id => id.toString()));

    // Get activities from these projects with detailed population
    const activities = await db.collection('checkins')
      .aggregate([
        {
          $match: {
            projectId: { $in: projectIds }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $lookup: {
            from: 'projects',
            localField: 'projectId',
            foreignField: '_id',
            as: 'project'
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $limit: 100
        }
      ])
      .toArray();

    console.log(`📊 Found ${activities.length} total activities`);

    // Enhanced formatting with better debugging
    const formattedActivities = activities.map(activity => {
      const userData = activity.user && activity.user[0] ? {
        _id: activity.user[0]._id,
        name: activity.user[0].name,
        profilePic: activity.user[0].profilePic
      } : {
        _id: activity.userId,
        name: 'Unknown User',
        profilePic: null
      };

      const projectData = activity.project && activity.project[0] ? {
        _id: activity.project[0]._id,
        name: activity.project[0].name,
        image: activity.project[0].image,
        owner: activity.project[0].owner
      } : {
        _id: activity.projectId,
        name: 'Unknown Project',
        image: null,
        owner: null
      };

      const isFriendActivity = friendIds.some(fid => 
        fid.toString() === userData._id?.toString()
      );

      return {
        _id: activity._id,
        message: activity.message,
        action: activity.action,
        timestamp: activity.timestamp,
        likes: activity.likes || 0,
        downloads: activity.downloads || 0,
        files: activity.files || [],
        userId: userData,
        projectId: projectData,
        // Debug info
        _debug: {
          isYourActivity: userData._id.toString() === userId,
          isFriendActivity: isFriendActivity,
          projectOwner: projectData.owner?.toString(),
          activityUserId: activity.userId?.toString()
        }
      };
    });

    // Count friend activities
    const friendActivities = formattedActivities.filter(a => a._debug.isFriendActivity);
    console.log(`👥 Found ${friendActivities.length} friend activities`);
    
    friendActivities.forEach(activity => {
      console.log(`🎯 Friend Activity: ${activity.userId.name} - ${activity.message} - Project: ${activity.projectId.name}`);
    });

    res.json({ 
      success: true, 
      activities: formattedActivities,
      debug: {
        userId,
        friendCount: friendIds.length,
        projectCount: projects.length,
        totalActivities: activities.length,
        friendActivityCount: friendActivities.length,
        friendActivities: friendActivities.map(a => ({
          user: a.userId.name,
          message: a.message,
          project: a.projectId.name
        }))
      }
    });
    
  } catch (error) {
    console.error('❌ Error in fixed local activity endpoint:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

app.get('/api/debug/find-friend-activity', async (req, res) => {
  try {
    // Temporary auth bypass for testing
    const userId = '68de9202335ebe602d694ed2';
    const friendId = '68de92e8335ebe602d694ed4';
    const activityId = '68decb5294a85db483f6a9d9';

    console.log('🔍 Looking for specific friend activity:', activityId);

    // 1. Check if activity exists in checkins collection
    const activity = await db.collection('checkins').findOne({
      _id: new ObjectId(activityId)
    });

    if (!activity) {
      return res.json({
        success: false,
        message: "Activity not found in checkins collection"
      });
    }

    console.log('✅ Activity found:', activity.message);

    // 2. Check if the project exists
    let project = null;
    try {
      project = await db.collection('projects').findOne({
        _id: new ObjectId(activity.projectId)
      });
    } catch (error) {
      console.log('❌ Project not found or invalid project ID');
    }

    // 3. Check friendship
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(userId) },
      { projection: { friends: 1, name: 1 } }
    );

    const friend = await db.collection('users').findOne(
      { _id: new ObjectId(friendId) },
      { projection: { friends: 1, name: 1 } }
    );

    const isMutualFriends = user && user.friends && user.friends.some(f => f.toString() === friendId) &&
                           friend && friend.friends && friend.friends.some(f => f.toString() === userId);

    console.log('👥 Mutual friendship:', isMutualFriends);

    // 4. Check what projects would be included in local feed
    const relevantUserIds = [new ObjectId(userId), new ObjectId(friendId)];
    const relevantProjects = await db.collection('projects').find({
      $or: [
        { owner: { $in: relevantUserIds } },
        { members: { $in: relevantUserIds } }
      ]
    }).toArray();

    const isProjectInRelevant = project ? 
      relevantProjects.some(p => p._id.toString() === activity.projectId.toString()) :
      false;

    res.json({
      success: true,
      summary: {
        activityExists: true,
        projectExists: !!project,
        isMutualFriends: isMutualFriends,
        isProjectInLocalFeed: isProjectInRelevant,
        reasonNotShowing: !project ? "Project was deleted" :
                        !isProjectInRelevant ? "Project not accessible to you" :
                        !isMutualFriends ? "Not mutual friends" :
                        "Should be visible in local feed"
      },
      activity: {
        id: activity._id.toString(),
        userId: activity.userId.toString(),
        message: activity.message,
        projectId: activity.projectId.toString(),
        timestamp: activity.timestamp,
        action: activity.action
      },
      project: project ? {
        id: project._id.toString(),
        name: project.name,
        owner: project.owner.toString(),
        members: project.members ? project.members.map(m => m.toString()) : []
      } : null,
      friendship: {
        yourFriends: user ? user.friends.map(f => f.toString()) : [],
        friendFriends: friend ? friend.friends.map(f => f.toString()) : [],
        isMutual: isMutualFriends
      },
      localFeed: {
        relevantProjectsCount: relevantProjects.length,
        yourProjects: relevantProjects.filter(p => p.owner.toString() === userId).length,
        friendProjects: relevantProjects.filter(p => p.owner.toString() === friendId).length
      }
    });

  } catch (error) {
    console.error('❌ Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ========== STATIC FILES AND SERVER STARTUP ==========

app.use(express.static(path.join(__dirname, '../frontend/public')));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

// Server startup function
async function startServer(){
  try{
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
    console.log('✅ Connected to MongoDB');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Frontend: http://localhost:3000`);
      console.log(`🔧 Backend API: http://localhost:${PORT}/api`);
    });
  }catch(error){
    console.error('❌ Failed to connect to MongoDB', error);
    process.exit(1);   
  }
};

startServer();
