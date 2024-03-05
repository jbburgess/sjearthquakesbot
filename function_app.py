'''
Collection of Azure Functions for the Reddit bot /u/SJEarthquakesBot.

This file contains the following Azure Functions:
    - post_news: Scheduled Azure Function to check the Earthquakes news site
      and post new articles to subreddit.
    - get_schedule: Scheduled Azure Function to check the Earthquakes match
      schedule and trigger match thread functions when needed.

This file also contains the following internal functions:
    - _get_newsarticles: Internal function to parse news articles from the
      Earthquakes website News page.
    - _get_submissions: Internal function to retrieve recent posts in subreddit and filter
      to threads matching the provided name, flair, and stickied status.
    - _http_request: Internal function to make HTTP requests.
    - _init_reddit_connection: Internal function to initialize the reddit 
      connection to the configured subreddit.
    - _unsticky_match_thread: Internal function to unsticky match threads.
'''

import datetime
import gc
import json
import logging
import os
import sys
from typing import Optional
from urllib import request

import azure.functions as func
from bs4 import BeautifulSoup
from icalendar import Calendar
import praw
import requests

app = func.FunctionApp()

@app.schedule(schedule="0 */5 0-3,14-23 * * *", arg_name="timer", run_on_startup=True,
              use_monitor=False)
def post_news(timer: func.TimerRequest) -> None:
    '''
    Scheduled Azure Function to check the Earthquakes news site and post new articles to the subreddit.

    Args:
        timer: The Azure Function timer trigger.

    Returns:
        None

    Raises:
        Any exceptions encountered when initializing the reddit connection, retrieving subreddit posts, or posting articles.
    '''

    utc_timestamp = datetime.datetime.utcnow().replace(
        tzinfo=datetime.timezone.utc).isoformat()

    logging.debug('Python timer trigger function ran at %s', utc_timestamp)

    # Initialize environmental variables.
    flair_id = os.environ["Reddit_Submission_News_FlairID"]
    resubmit = os.environ["Reddit_Submission_Resubmit"]
    send_replies = os.environ["Reddit_Submission_SendReplies"]
    subreddit = os.environ["Reddit_Subreddit"]

    cutoff_days = int(os.environ["NewsSite_ArticleCutoffDays"])

    cutoffutc = datetime.datetime.utcnow() - datetime.timedelta(days = cutoff_days)

    #Retrieve new articles from Earthquakes website.
    articles = _get_newsarticles()

    # Connect to subreddit if new articles were found.
    if articles:
        try:
            reddit = _init_reddit_connection()
            subreddit = reddit.subreddit(subreddit)
        except:
            logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
            raise

        # Retrieve recent posts in subreddit
        subreddit_urls = []

        try:
            logging.debug('Retrieving subreddit posts.')

            for submission in subreddit.new(limit=50):
                normalized_url = submission.url.lower()
                subreddit_urls.append(normalized_url)
        except:
            logging.error('Unexpected error when retrieving subreddit posts:%s', sys.exc_info()[0])
            raise

        # Retrieve removed links in subreddit
        removed_urls = []

        try:
            logging.debug('Retrieving removed subreddit links.')

            for log in subreddit.mod.log(action='removelink',limit=20):
                actiontimestamp = datetime.datetime.utcfromtimestamp(log.created_utc)
                if actiontimestamp < cutoffutc:
                    logging.debug('Removal action is old, skipping: %s', log.target_title)
                else:
                    submission = reddit.submission(log.target_fullname.lstrip('t3_'))
                    normalized_url = submission.url.lower()
                    removed_urls.append(normalized_url)
                    logging.debug('Link added: %s', submission.url)
        except:
            logging.error('Unexpected error when retrieving removed subreddit links:%s', sys.exc_info()[0])
            raise

        # Process each article.
        if subreddit_urls:
            for article in articles:
                # Skip article already posted to subreddit.
                if article['link'] in subreddit_urls:
                    logging.debug('Article already posted, skipping: %s', article['title'])
                else:
                    # Skip article if it was already posted and then removed by mods.
                    if article['link'] in removed_urls:
                        logging.info('Article already posted and then removed by mods, skipping: %s', article['title'])
                    else:
                        # Build submission parameter splat.
                        submit_params = {
                            'title': article['title'],
                            'url': article['link'],
                            'flair_id': flair_id,
                            'resubmit': resubmit,
                            'send_replies': send_replies
                        }

                        # Submit new post to subreddit.
                        try:
                            subreddit.submit(**submit_params)
                        except praw.exceptions.RedditAPIException as exception:
                            for subexception in exception.items:
                                if subexception.error_type == 'ALREADY_SUB':
                                    logging.critical('Error encountered when posting article (%s): Article has already been posted, but was not caught by list comparison.', article["title"])
                                    raise
                                else:
                                    logging.error('Unexpected Reddit API error encountered when posting article (%s): %s, %s', article["title"], subexception.error_type, subexception.message)
                                    raise
                        except:
                            logging.error('Unexpected error when posting article (%s): %s', article["title"], sys.exc_info()[0])
                            raise
                        else:
                            logging.info('New article successfully posted: %s', article['title'])
            del subreddit_urls
            del removed_urls
        else:
            logging.warning('No subreddit post URLs retrieved.')

        del articles
    else:
        logging.info('No new articles retrieved from news site.')

    # Sleep for configured interval before checking for news again.
    gc.collect()

# Scheduled Azure Function to check Earthquakes match schedule and trigger match thread Function when needed.
@app.timer_trigger(schedule="0 */5 0-3,14-23 * * *", arg_name="timer", run_on_startup=True,
              use_monitor=False)
def get_schedule(timer: func.TimerRequest) -> None:
    '''
    Scheduled Azure Function to check the Earthquakes match schedule and trigger match thread functions when needed.
    
    Args:
        timer: The Azure Function timer trigger.
        
    Returns:
        None
        
    Raises:
        Any exceptions encountered when initializing the reddit connection, retrieving subreddit posts, or calling match thread functions.
    '''

    now = datetime.datetime.now(datetime.timezone.utc)

    # Initialize environmental variables
    schedule_url = os.environ["Schedule_URL"]
    thread_function_url = os.environ["Reddit_MatchThread_FunctionURL"]

    # Retrieve .ics file from website and parse events.
    response = requests.get(schedule_url, timeout = 10)

    if response.status_code == 200:
        ics_data = response.text
        calendar = Calendar.from_ical(ics_data)
        events = []
        for component in calendar.walk():
            if component.name == "VEVENT":
                event = {
                    "summary": component.get("summary"),
                    "start": component.get("dtstart").dt,
                    "end": component.get("dtend").dt,
                    "location": component.get("location"),
                    "description": component.get("description"),
                }
                events.append(event)
    else:
        raise ValueError("Failed to retrieve .ics file")

    # Filter to events happening only in the window of interest.
    if events:
        yesterday = now + datetime.timedelta(hours = -26, minutes = -2.5)
        tomorrow = now + datetime.timedelta(hours = 12, minutes = 2.5)
        events = [event for event in events if event["start"] > yesterday and event["start"] < tomorrow]

    # Process filtered events and call appropriate match thread functions
    if events:
        # Initialize data to be sent to match thread function
        data = {
            "event": event
        }

        # Check event time relative to now and call match thread function for appropriate thread type as needed.
        for event in events:
            if event["start"] < now + datetime.timedelta(hours = 12, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = 12, minutes = -2.5):
                data["type"] = "prematch"
                _http_request(thread_function_url, "POST", data)
            elif event["start"] < now + datetime.timedelta(hours = 1, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = 1, minutes = -2.5):
                data["type"] = "match"
                _http_request(thread_function_url, "POST", data)
            elif event["start"] < now + datetime.timedelta(hours = -2, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = -2, minutes = -2.5):
                data["type"] = "postmatch"
                _http_request(thread_function_url, "POST", data)
            elif event["start"] < now + datetime.timedelta(hours = -26, minutes = 2.5) and event["start"] > now + datetime.timedelta(hours = -26, minutes = -2.5):
                _unsticky_match_threads(event)
            else:
                logging.debug("Event outside of window of interest: %s, %s", event["summary"], event["start"])

# Internal function to retrieve news articles from Earthquakes website.
def _get_newsarticles():
    '''
    Retrieve news articles from Earthquakes website.

    Args:
        None

    Returns:
        A list of dictionaries containing the news articles.

    Raises:
        Any exceptions encountered when retrieving news articles.
    '''

    # Initialize environmental variables.
    base_url = os.environ["NewsSite_BaseURL"]
    news_url = base_url + os.environ["NewsSite_NewsURL"]
    max_articles = int(os.environ["NewsSite_MaxArticles"])
    cutoff_days = int(os.environ["NewsSite_ArticleCutoffDays"])

    # Retrieve Earthquakes website news page and parse text articles.
    headers = {"User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.9.2.8) Gecko/20100722 Firefox/3.6.8 GTB7.1 (.NET CLR 3.5.30729)", "Referer": "http://example.com"}
    page = requests.get(news_url, headers=headers, timeout=5)
    soup = BeautifulSoup(page.content, 'html.parser')
    results = soup.find("section", class_='d3-l-grid--outer d3-l-section-row')
    article_elems = results.find_all("div", class_='d3-l-col__col-3')

    if article_elems:
        cutoffutcutc = datetime.datetime.utcnow() - datetime.timedelta(days = cutoff_days)
        articles = []

        for article_elem in article_elems[:max_articles]:
            # Parse article information.
            title = article_elem.a['title']
            href = article_elem.a['href']
            link = base_url + href

            # If article is a "NEWS:" post and not a duplicate, add to articles array.
            if "NEWS: " in title:
                if link in [i['link'] for i in articles]:
                    logging.debug('Duplicate article skipped: %s', title)
                else:
                    # Retrieve timestamp from article page.
                    articlepage = requests.get(link, timeout = 10)
                    articlesoup = BeautifulSoup(articlepage.content, 'html.parser')
                    timestamp_elem = articlesoup.find('div', class_='oc-c-article__date')
                    timestamp = timestamp_elem.p['data-datetime']
                    articledate = datetime.datetime.strptime(timestamp, '%m/%d/%Y %H:%M:%S')

                    if articledate < cutoffutcutc:
                        logging.debug('Old article skipped: %s', title)
                    else:
                        article = {
                            'title': title,
                            'link': link,
                            'timestamp': timestamp
                        }
                        articles.append(article)
                        logging.info('Article added: %s', title)
            else:
                logging.debug('Non-news article skipped: %s', title)

        del article_elems
    else:
        logging.critical('No article elements found on news site.')

    del page
    del soup
    del results

    return articles

# Internal function to retrieve recent posts in subreddit and filter to threads matching the provided name, flair, and stickied status.
def _get_submissions(name: str, flair: Optional[str] = None, stickied: Optional[bool] = None) -> list:
    '''
    Retrieve recent posts in subreddit and filter to threads matching the provided name, flair, and stickied status.

    Args:
        name: The name of the thread to filter to.
        flair: The flair of the thread to filter to.
        stickied: The stickied status of the thread to filter to.

    Returns:
        A list of dictionaries containing the filtered threads.

    Raises:
        Any exceptions encountered when initializing the reddit connection or retrieving subreddit posts.
    '''

    # Initialize environmental variables.
    subreddit = os.environ["Reddit_Subreddit"]

    # Connect to subreddit
    try:
        reddit = _init_reddit_connection()
        subreddit = reddit.subreddit(subreddit)
    except:
        logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
        raise

    # Retrieve recent posts in subreddit
    submissions = []

    try:
        logging.debug('Retrieving subreddit posts.')

        for submission in subreddit.new(limit=100):
            submission_dict = {
                "author": submission.author.name,
                "created": submission.created_utc,
                "id": submission.id,
                "link_flair_text": submission.link_flair_text,
                "name": submission.name,
                "permalink": submission.permalink,
                "stickied": submission.stickied,
                "title": submission.title.lower(),
            }

            submissions.append(submission_dict)
    except:
        logging.error('Unexpected error when retrieving subreddit posts:%s', sys.exc_info()[0])
        raise

    if submissions:
        # Filter to threads matching the provided name.
        submissions = [submission for submission in submissions if name.lower() in submission['title'].lower()]

        # If a flair was provided, filter to threads matching the provided flair.
        if flair:
            submissions = [submission for submission in submissions if submission['link_flair_text'] and flair.lower() in submission['link_flair_text'].lower()]

        # If stickied is provided, filter to threads matching the provided stickied status.
        if stickied:
            submissions = [submission for submission in submissions if submission['stickied'] == stickied]
    else:
        logging.error('No subreddit posts retrieved.')

    return submissions

# Internal function to make HTTP requests.
def _http_request(url, method, data: Optional[dict] = None) -> bytes:
    req = request.Request(url, method = method)
    req.add_header('Content-Type', 'application/json')

    if data:
        data = json.dumps(data)
        data = data.encode()
        with request.urlopen(req, data = data) as r:
            content = r.read()
    else:
        with request.urlopen(req) as r:
            content = r.read()

    return content

# Internal function to initialize the reddit connection to the configured subreddit.
def _init_reddit_connection() -> praw.Reddit:
    '''
    Initialize the reddit connection to the configured subreddit.

    Args:
        None

    Returns:
        The initialized reddit connection.

    Raises:
        Any exceptions encountered when initializing the reddit connection.
    '''

    # Initialize environmental variables.
    user_agent = os.environ["Reddit_Connection_UserAgent"]
    client_id = os.environ["Reddit_Connection_ClientID"]
    client_secret = os.environ["Reddit_Connection_ClientSecret"]
    username = os.environ["Reddit_Connection_Username"]
    password = os.environ["Reddit_Connection_Password"]

    # Connect to reddit
    try:
        reddit = praw.Reddit(
            user_agent = user_agent,
            client_id = client_id,
            client_secret = client_secret,
            username = username,
            password = password,
        )
    except:
        logging.error('Unexpected error when initializing reddit connection:%s', sys.exc_info()[0])
        raise

    return reddit

# Internal function to unsticky match threads.
def _unsticky_match_threads(event):
    '''
    Unsticky any stickied match threads.

    Args:
        event: The event to unsticky the match thread for.
    
    Returns:
        None

    Raises:
        Any exceptions encountered when initializing the reddit connection or unstickying match threads.
    '''

    # Initialize environmental variables.
    subreddit = os.environ["Reddit_Subreddit"]

    # Connect to subreddit
    try:
        reddit = _init_reddit_connection()
        subreddit = reddit.subreddit(subreddit)
    except:
        logging.error('Unexpected error when initializing reddit connection and subreddit:%s', sys.exc_info()[0])
        raise

    stickied_threads = _get_submissions(event["summary"], flair = "Match", stickied = True)

    if stickied_threads:
        for thread in stickied_threads:
            try:
                submission = reddit.submission(thread["id"])
                submission.mod.sticky(state = False, bottom = False)
            except:
                logging.error('Unexpected error when unstickying match thread:%s', sys.exc_info()[0])
                raise
            
            logging.info('Match thread unstickied: %s', thread["title"])
