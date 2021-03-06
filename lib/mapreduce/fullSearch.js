var stopwords = require('natural').stopwords;
var async = require('async');
var scontext = require('search-context');
var indexSize = 0;

exports.search = function (reverseIndex, docFreqIndex, q, callback) {

  docFreqIndex.get('forage.totalDocs', function (err, value) {
    indexSize = value;
  });

  //this must be set to true for a query to be carried out
  var canSearch = true,
  //tq = Transformed Query
      tq = Object.create(q),
      k,
      indexKeys,
      i,
      j,
      filterArray,
      startKey,
      stopKey;

  //remove stopwords
  tq['query'] = [];
  for (k = 0; k < q['query'].length; k++) {
    if (stopwords.indexOf(q['query'][k]) == -1) {
      tq['query'].push(q['query'][k]);
    }
  }
  if (tq['query'].length === 0) {
    canSearch = false;
  }



  //terms to look up in the reverse index
  indexKeys = [];

  if (q['filter']) {
    //make a filter set for every term in the query
    for (i = 0; i < tq['query'].length; i++) {
      //for every filter type
      for (j in q['filter']) {
        //TAG FILTER
        if (Array.isArray(q['filter'][j])) {
          //for every filter value in the array
          filterArray = q['filter'][j];
          for (k = 0; k < filterArray.length; k++) {
            if (q['searchFields']) {
              for (j = 0; j < q['searchFields'].length; j++) {
                startKey = 'REVERSEINDEX~'
                  + tq['query'][i] + '~'
                  + j + '~'
                  + filterArray[k] + '~'
                  + q['searchFields'][j] + '~';
                stopKey = 'REVERSEINDEX~'
                  + tq['query'][i] + '~'
                  + j + '~'
                  + filterArray[k] + '~'
                  + q['searchFields'][j] + '~~';
                indexKeys.push({'startKey': startKey,
                                'stopKey': stopKey});
              }
            }
            else {
              startKey = 'REVERSEINDEX~'
                + tq['query'][i] + '~'
                + j + '~'
                + filterArray[k] + '~';
              stopKey = 'REVERSEINDEX~'
                + tq['query'][i] + '~'
                + j + '~'
                + filterArray[k] + '~~';
              indexKeys.push({'startKey': startKey,
                              'stopKey': stopKey});
            }
          }
        }
        //RANGE FILTER
        else if (q['filter'][j].start) {
          if (q['searchFields']) {
            for (j = 0; j < q['searchFields'].length; j++) {
              startKey = 'REVERSEINDEX~' 
                + tq['query'][i] + '~'
                + j + '~'
                + q['filter'][j].start + '~'
                + q['searchFields'][j] + '~';
              stopKey = 'REVERSEINDEX~'
                + tq['query'][i] + '~'
                + j + '~'
                + q['filter'][j].stop + '~'
                + q['searchFields'][j] + '~~';
              indexKeys.push({'startKey': startKey,
                              'stopKey': stopKey});
            }
          }
          else {
            startKey = 'REVERSEINDEX~' 
              + tq['query'][i] + '~'
              + j + '~'
              + q['filter'][j].start + '~';
            stopKey = 'REVERSEINDEX~'
              + tq['query'][i] + '~'
              + j + '~'
              + q['filter'][j].stop + '~~';
            indexKeys.push({'startKey': startKey,
                            'stopKey': stopKey});
          }
        }
      }
    }
  }
  else {

    for (i = 0; i < tq['query'].length; i++) {
      if (q['searchFields']) {
        for (j = 0; j < q['searchFields'].length; j++) {
          //no faceting
          startKey = 'REVERSEINDEX~'
            + tq['query'][i] + '~~~'
            + q['searchFields'][j] + '~';
          stopKey = 'REVERSEINDEX~'
            + tq['query'][i] + '~~~'
            + q['searchFields'][j] + '~~';
          indexKeys.push({'startKey': startKey, 'stopKey': stopKey});
        }
      }
      else {
        //no faceting
        startKey = 'REVERSEINDEX~'
          + tq['query'][i] + '~~~';
        stopKey = 'REVERSEINDEX~'
          + tq['query'][i] + '~~~~';
        indexKeys.push({'startKey': startKey, 'stopKey': stopKey});
      }
    }
  }
  if (canSearch) {
    getSearchResults(reverseIndex, q, tq, 0, {}, {}, indexKeys, function(msg) {
      callback(msg);
    });
  }
  else callback('no results');
};


function getSearchResults (reverseIndex, q, tq, i, docSet, idf, indexKeys, callbacky) {
  var queryTerms = tq['query'],
//FIX THIS!
//      availableFacets = indexMetaDataGlobal['availableFacets'],
      availableFacets = [],
      thisQueryTerm = indexKeys[i].startKey.split('~')[1],
      offset = ~~parseInt(q['offset']),
      pageSize = ~~parseInt(q['pageSize']),
      weight = {},
      idfCount;
  if (q['weight']) {
    weight = q['weight'];
  }
  idfCount = 0;
  reverseIndex.createReadStream({
    valueEncoding: 'json',
    start: indexKeys[i].startKey,
    end: indexKeys[i].stopKey})
    .on('data', function (data) {
      idfCount++;
      var splitKey = data.key.split('~'),
      docID = splitKey[6],
      fieldName = splitKey[4],
      tf = splitKey[5];
      //assign tf-idf per field and collate fields per doc
      if (fieldName != 'forage.composite') {
        if ((docSet[docID] == null) || (typeof docSet[docID] == 'function')){
          docSet[docID] = {};
          docSet[docID]['relevance'] = {};
          docSet[docID]['relevance']['tf'] = {};
          docSet[docID]['relevance']['tf'][thisQueryTerm] = {};
          docSet[docID]['relevance']['tf'][thisQueryTerm][fieldName] = tf;
          docSet[docID]['document'] = data.value.fields;
        } else if (docSet[docID]['relevance']['tf'][thisQueryTerm] == null) {
          docSet[docID]['relevance']['tf'][thisQueryTerm] = {};
          docSet[docID]['relevance']['tf'][thisQueryTerm][fieldName] = tf;
        } else {
          docSet[docID]['relevance']['tf'][thisQueryTerm][fieldName] = tf;
        }
      }
    })
    .on('end', function () {
      var k,
          resultSet,
          facetFields,
          m,
          filterIsPresent,
          l,
          totalMatchedTerms,
          score,
          searchTerm,
          IDF,
          documentHitFields,
          W,
          TF,
          documentFacetTags,
          j,
          compare;
      //move this line?
      if (idf[thisQueryTerm]) { 
        idf[thisQueryTerm] = (idf[thisQueryTerm] + idfCount);
      } else {
        idf[thisQueryTerm] = idfCount;
      }

      if (i < (indexKeys.length - 1)) {
        getSearchResults(reverseIndex, q, tq, ++i, docSet, idf, indexKeys, callbacky);
      }
      else {
        //idf generation in here

        for (k in idf) {
          idf[k] = Math.log(indexSize / idf[k]);
        }

        //generate resultset with tfidf
        resultSet = {};
        resultSet['idf'] = idf;
        resultSet['query'] = q;
        resultSet['transformedQuery'] = tq;
        resultSet['totalHits'] = 0;
        resultSet['facets'] = {};
        facetFields = [];

        if (q['facets']){
          facetFields = q['facets'];
        }
        else {
          facetFields = availableFacets; 
        }
        
        for (m = 0; m < facetFields.length; m++) {
          resultSet['facets'][facetFields[m]] = {};
        }

        resultSet['hits'] = [];

        docSetLoop:
        for (j in docSet) {
          //deal with filtering


          for (k in q.filter) {
            filterIsPresent = false;
            for (l = 0; l < q.filter[k].length; l++) {
              //if the filter field is missing- drop hit
              if (docSet[j].document[k] === undefined)
                continue docSetLoop;
              //if the filter value is present- mark as true
              if (docSet[j].document[k].indexOf(q.filter[k][l]) != -1)
                filterIsPresent = true;
            }
            //if this is still false, the hit did not contain the
            //right filter field value anywhere in the filter field
            //array
            if (!filterIsPresent) {
              continue docSetLoop;
            }
          }


          totalMatchedTerms = Object.keys(docSet[j]['relevance']['tf']).length;
          if (totalMatchedTerms < queryTerms.length) {
            continue docSetLoop;
          }
          else {
            hit = docSet[j];
            hit['id'] = j;
            score = 0;
            for (k in idf) {
              searchTerm = k;
              IDF = idf[k];
              documentHitFields = hit['relevance']['tf'][k];
              for (l in documentHitFields) {
                //weighting
                W = 1;
                if (weight[l]) {
                  W = parseInt(weight[l]);
                }
                TF = documentHitFields[l];
                score += (TF * IDF * W);
              }
              hit['score'] = score;
            }
            //faceting
            for (m = 0; m < facetFields.length; m++) {
              if (hit.document[facetFields[m]]) {
                documentFacetTags = hit.document[facetFields[m]];
                for (var n = 0; n < documentFacetTags.length; n++) {
                  if (!resultSet.facets[facetFields[m]][documentFacetTags[n]]) {
                    resultSet.facets[facetFields[m]][documentFacetTags[n]] = 0;
                  }
                  resultSet.facets[facetFields[m]][documentFacetTags[n]]++;
                }
              }
            }
            resultSet['hits'].push(hit);
          }
        }
        
        //array sort function
        compare = function(a,b) {
          if (a.score < b.score)
            return 1;
          if (a.score > b.score)
            return -1;
          return 0;
        };
        resultSet['totalHits'] = resultSet.hits.length;


        resultSet.hits = resultSet.hits.sort(compare)
          .slice(offset, (offset + pageSize));
        
        //glue doc to result
        fetchAndGlueDocument = function (item, callback) {
          reverseIndex.get('DOCUMENT~' + item.id + '~', function (err, value) {
            item['document'] = JSON.parse(value);
            //teaser generation
            if (q['teaser']) {
              try {
                item['document']['teaser'] = 
                  scontext(item['document'][q['teaser']],
                           queryTerms, 400,
                           function hi (string) {
                             return '<span class="sc-em">' + string + '</span>'
                           });
              } catch (e) {}
            }
            callback(null, item);
          });
        }
        
        //asynchronously glue documents to results
        async.map(resultSet.hits, fetchAndGlueDocument, function(err){
          callbacky(resultSet);
        });
      }
    });
};
