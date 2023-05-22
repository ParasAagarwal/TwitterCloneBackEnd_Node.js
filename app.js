const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const databasePath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeAndDbAndServer = async () => {
  try {
    db = await open({ filename: databasePath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log(`server is running on http://localhost:3000`);
    });
  } catch (error) {
    console.log(`DB Error : ${error.message}`);
    process.exit(1);
  }
};
initializeAndDbAndServer();

const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT
    following_user_id
    FROM
    follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE user.username='${username}';`;
  const followingPeople = await db.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT *
    FROM tweet INNER JOIN follower
    ON tweet.user_id = follower.following_user_id
    WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};
//1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const userDBDetails = await db.get(getUserQuery);
  if (userDBDetails !== undefined) {
    response.status = 400;
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
      INSERT INTO 
        user (username, password, name, gender) 
      VALUES 
        (
          '${username}', 
          '${hashedPassword}',
          '${name}', 
          '${gender}'
        )`;
      await db.run(createUserQuery);
      response.send(`User created successfully`);
    }
  }
});
//2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `select * from user where username = '${username}';`;
  const userDetails = await db.get(getUserQuery);
  if (userDetails !== undefined) {
    const isPasswordValid = await bcrypt.compare(
      password,
      userDetails.password
    );
    if (isPasswordValid) {
      const payload = { username, userId: userDetails.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});
//3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
  const getTweetsQuery = `SELECT
    username,tweet,date_time as dateTime
    FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE
    user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC
    LIMIT 4;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});
//4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUserQuery = `SELECT name FROM follower
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = '${userId}';`;
  const followingPeople = await db.all(getFollowingUserQuery);
  response.send(followingPeople);
});
//5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowersQuery = `SELECT DISTINCT name FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE following_user_id = '${userId}';`;
  const followers = await db.all(getFollowersQuery);
  response.send(followers);
});
//6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT tweet,
  (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
  (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
  date_time AS dateTime
  FROM tweet
  WHERE tweet.tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);
//7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT username
  FROM user INNER JOIN like ON user.user_id = like.user_id
  WHERE tweet_id = '${tweetId}';`;
    const likedUsers = await db.all(getLikesQuery);
    const usersArray = likedUsers.map((eachUser) => eachUser.username);
    response.send({ likes: usersArray });
  }
);
//8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `SELECT name,reply
  FROM user INNER JOIN reply ON user.user_id = reply.user_id
  WHERE tweet_id = '${tweetId}';`;
    const repliedUsers = await db.all(getRepliedQuery);
    response.send({ replies: repliedUsers });
  }
);
//9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = `SELECT tweet,
   COUNT(DISTINCT like_id) AS likes,
   COUNT(DISTINCT reply_id) AS replies,
   date_time AS dateTime
   FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
   LEFT JOIN like ON tweet.tweet_id = like.tweet_id
   WHERE tweet.user_id =${userId}
   GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});
//10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time)
  VALUES('${tweet}','${userId},'${dateTime}')`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});
//11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;
    const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userID}' AND tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTheTweetQuery);
    console.log(tweet);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);
module.exports = app;
