const express = require('express')
const app = express()
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const path = require('path')
const cors = require('cors')
app.use(cors())
app.use(express.json())
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const dbPath = path.join(__dirname, 'twitterClone.db')
let db
const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
  } catch (error) {
    console.log(`DB Erro:-${error.message}`)
    process.exit(1)
  }
}
initializeDbAndServer()

app.get('/all', async (req, res) => {
  const rows = await db.all(`select * from user`)
  res.status(200)
  res.send(rows)
})

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const userExists = `select * from user where username='${username}'`
  const userData = await db.get(userExists)
  //console.log(userData)
  if (userData === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hasing = await bcrypt.hash(password, 10)
      const postQuery = `
      insert 
        into
      user
        (username,password,name,gender)
      values
        ('${username}','${hasing}','${name}','${gender}')
      `
      await db.run(postQuery)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const userQuery = `select * from user where username='${username}'`
  const userExists = await db.get(userQuery)
  if (userExists !== undefined) {
    const matched = await bcrypt.compare(password, userExists.password)
    if (matched) {
      const jwtToken = jwt.sign(userExists, 'Secret_key')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})
const authenticateToken = (request, response, next) => {
  const {tweet} = request.body
  const {tweetId} = request.params
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'Secret_key', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.payload = payload
        request.tweetId = tweetId
        request.tweet = tweet
        next()
      }
    })
  }
}
app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const queryIds = `
  SELECT
     username,
     tweet,
     date_time as dateTime
  FROM
    follower INNER JOIN tweet ON follower.following_user_id=tweet.user_id INNER JOIN user ON user.user_id=follower.following_user_id
  WHERE
    follower.follower_user_id =${user_id}
  ORDER BY
     date_time desc
  LIMIT 4;
  `
  const tweets = await db.all(queryIds)
  response.send(tweets)
})
app.get('/user/following/', authenticateToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const userQuery = `
    select 
      name
    from
      user inner join follower on user.user_id=follower.following_user_id
    where
      follower.follower_user_id=${user_id}
  `
  const followingArray = await db.all(userQuery)
  response.send(followingArray)
})
app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const followersQuery = `
    select 
      name
    from
      user inner join follower on user.user_id=follower.follower_user_id
    where
      follower.following_user_id=${user_id}
  `
  const followersArray = await db.all(followersQuery)
  response.send(followersArray)
})
app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const tweetsQuery = `
    select * from tweet where tweet_id=${tweetId}
  `
  const tweetsArray = await db.get(tweetsQuery)
  const followersQuery = `
    select 
      *
    from 
      follower inner join user on user.user_id=follower.following_user_id
    where
      follower.follower_user_id=${user_id}
  `
  const userFollowers = await db.all(followersQuery)
  if (
    userFollowers.some(item => item.following_user_id === tweetsArray.user_id)
  ) {
    const tweetDetailsQuery = `
      select 
        tweet,
        count(distinct(like.like_id)) as likes,
        count(distinct(reply.reply_id)) as replies,
        tweet.date_time as dateTime
      from 
        tweet inner join like on tweet.tweet_id = like.tweet_id inner join reply on reply.tweet_id = tweet.tweet_id
      where
        tweet.tweet_id=${tweetId} and tweet.user_id=${userFollowers[0].user_id};
    `
    const tweetDetails = await db.get(tweetDetailsQuery)
    response.send(tweetDetails)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})
app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request
    const {payload} = request
    const {user_id, name, username, gender} = payload
    const likedUserQuery = `
    select 
      * 
    from 
      follower inner join tweet on tweet.user_id=follower.following_user_id inner join like on like.tweet_id=tweet.tweet_id
      inner join user on user.user_id=like.user_id
    where
      tweet.tweet_id=${tweetId} and follower.follower_user_id=${user_id}
  `
    const likedUser = await db.all(likedUserQuery)
    if (likedUser.length !== 0) {
      let likes = []
      const namesArray = likedUser => {
        for (let i of likedUser) {
          likes.push(i.username)
        }
      }
      namesArray(likedUser)
      response.send({likes})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)
app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request
    const {payload} = request
    const {user_id} = payload

    const repliedUsersQuery = `
    SELECT user.name, reply.reply
    FROM follower 
    INNER JOIN tweet ON tweet.user_id = follower.following_user_id 
    INNER JOIN reply ON reply.tweet_id = tweet.tweet_id 
    INNER JOIN user ON user.user_id = reply.user_id
    WHERE tweet.tweet_id = ${tweetId} AND follower.follower_user_id = ${user_id}
  `

    const repliedUsers = await db.all(repliedUsersQuery)

    if (repliedUsers.length !== 0) {
      let replies = []
      repliedUsers.forEach(i => {
        replies.push({name: i.name, reply: i.reply})
      })
      response.send({replies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const tweetsDetailsQuery = `
  select
    tweet.tweet as tweet,
    count(distinct(like.like_id)) as likes,
    count(distinct(reply.reply_id)) as replies,
    tweet.date_time as dateTime
  from 
    user inner join tweet on user.user_id=tweet.user_id inner join like on like.tweet_id=tweet.tweet_id inner join reply on reply.tweet_id=tweet.tweet_id
  where
    user.user_id=${user_id}
  group by
    tweet.tweet_id
  `
  const tweetsDetails = await db.all(tweetsDetailsQuery)
  response.send(tweetsDetails)
})
app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request
  const {tweetId} = request
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const tweetQuery = `
  insert into
    tweet (tweet,user_id)
  values('${tweet}',${user_id})
  `
  await db.run(tweetQuery)
  response.send('Created a Tweet')
})
app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request
    const {payload} = request
    const {user_id, name, username, gender} = payload
    const selectedUserQuery = `select * from tweet where tweet.user_id=${user_id} and tweet.tweet_id=${tweetId}`
    const tweetUser = await db.all(selectedUserQuery)
    if (tweetUser.length !== 0) {
      const deleteQuery = `
      delete 
      from 
        tweet
      where
        tweet.user_id=${user_id} and tweet.tweet_id=${tweetId}
    `
      await db.run(deleteQuery)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)
app.listen(3007, () => {
  console.log('Server running at http://localhost:3007/...')
})
module.exports = app
